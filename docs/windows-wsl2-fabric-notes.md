# Running the Fabric test network on Windows

`entrypoint.sh` was written for Linux (the thesis used Ubuntu 20.04 on a
Linode instance) and assumes a real Linux shell. This document records what
actually happened trying to run it on Windows, so the next person doesn't have to rediscover it. Short version: **use WSL2 with a
real Linux distro. Don't try to run the live network directly in Git Bash.**

## Attempt 1: native Windows + Git Bash — doesn't work

Git Bash (MSYS2) automatically translates POSIX-style paths (`/c/Users/...`)
to Windows paths (`C:\Users\...`) when invoking a *native Windows* binary,
so a native tool can find the file it's given. This is necessary for
Fabric's own native Windows binaries:

- `configtxgen.exe` / `cryptogen.exe` need this translation **enabled** to
  resolve `FABRIC_CFG_PATH` and similar path arguments.

But it actively breaks Docker invocations, which need paths passed through
*unmangled* so they resolve correctly **inside the Linux container**, not
on the Windows host:

- Without `MSYS_NO_PATHCONV=1`, a Docker command referencing a
  container-internal path like `/data` gets rewritten into a nonsensical
  Windows path before Docker ever sees it. We hit this directly: a
  `docker-compose` container-recreate attempt tried to
  `mkdir C:\Program Files\Git\var` and failed with Access Denied, because
  Git Bash silently rewrote a relative bind-mount path.

`entrypoint.sh`'s underlying scripts (`network.sh` → `createChannel.sh` →
`configtxgen`, plus `docker-compose` for the peers/orderer) mix both kinds
of invocation **in the same script run**. Toggling `MSYS_NO_PATHCONV`
between commands doesn't just fail cleanly — it changes how `docker-compose`
computes each container's config hash, so it decides mid-script that
containers need to be *recreated*, and that recreate is exactly the
operation that fails on the bad path. We ended up with peer containers
knocked into `Exited` state mid-flow.

**Conclusion**: this isn't a one-line fix. It's a structural conflict
between what Fabric's native Windows binaries need and what Docker (running
Linux containers) needs, within scripts that call both. Hyperledger Fabric's
own documentation recommends WSL2 for Windows users for exactly this
reason. That recommendation is correct, not just caution.

## Attempt 2: WSL2 + Ubuntu — the distro itself failed to start

WSL2 was already present (Docker Desktop uses it internally), but the only
registered distro was Docker Desktop's own internal `docker-desktop` one. No general-purpose Linux distro was installed.

`wsl --install -d Ubuntu --no-launch` completed successfully, but the
distro then **failed to start at all**, on every attempt including a full
unregister + reinstall:

```
Falha catastrófica
Código de erro: Wsl/Service/E_UNEXPECTED
```
(`Catastrophic failure — Wsl/Service/E_UNEXPECTED`)

Since Docker Desktop's own WSL2-backed distros (`docker-desktop`,
`docker-desktop-data`) started fine, the WSL2 platform itself was healthy —
this pointed at something specific to the Ubuntu WSL image (current Ubuntu
WSL images enable `systemd` by default, which is a known source of WSL
launch failures on some Windows builds/configurations).

**One caution learned here**: running `wsl --shutdown` to try to reset
things also took down **Docker Desktop's own backend**, since it shares the
WSL2 infrastructure. `docker ps` stopped working entirely until Docker
Desktop was manually restarted. If you're debugging WSL and Docker Desktop
is running, know that `wsl --shutdown` affects it too.

## Attempt 3: WSL2 + Debian — this worked

Installing Debian instead (`wsl --install -d Debian --no-launch`) started
without issue on the first try. Debian's WSL image doesn't enable systemd
by default, consistent with the systemd theory above. If you hit the same
`E_UNEXPECTED` failure with Ubuntu, try Debian (or another non-systemd-by-
default distro) rather than troubleshooting Ubuntu further.

Steps to get a working setup from here:

1. **Enable Docker Desktop's WSL integration for the new distro.** This is
   not automatic for a newly installed distro — Docker Desktop → Settings →
   Resources → WSL Integration → toggle the distro on → Apply & Restart.
   Without this, `docker` isn't on `PATH` inside the distro at all.
2. **Install prerequisites** `entrypoint.sh` doesn't mention but the
   scripts need: `apt-get install -y curl git jq`. Specifically, `jq` isn't
   present on a fresh Debian image, and its absence fails
   `createChannel.sh`'s anchor-peer-setting step with an unhelpful "Failed
   to parse channel configuration" error rather than a clear
   "jq: command not found." This isn't just cosmetic: if `createChannel.sh`
   exits before reaching that step (for this reason or any other - we also
   hit it by re-running the script after peers had already joined, which
   exits early on "ledger already exists"), the channel's anchor peers
   never get set. The native `peer` CLI still works fine without them, but
   `server.js` (the SDK client, which uses discovery to find endorsing
   peers) will fail with `DiscoveryService: ... failed constructing
   descriptor for chaincodes`. If you hit that error, check whether anchor
   peers actually got set - re-run just that part directly if needed:
   `cd test-network && . scripts/envVar.sh && . scripts/setAnchorPeer.sh 1
   canal-str && . scripts/setAnchorPeer.sh 2 canal-str` (needs `PATH`/
   `FABRIC_CFG_PATH` exported first, same as `entrypoint.sh` sets them).
3. **Run `install-fabric.sh` fresh inside the distro**, not by reusing the
   Windows-side install. The binaries are platform-specific
   (`hyperledger-fabric-windows-amd64-*.tar.gz` vs. `-linux-amd64-*`), so
   Windows binaries downloaded during Attempt 1 don't run inside Linux.
   Docker *images* are shared automatically (same Docker Desktop engine
   underneath), so those steps are instant on a second install.
4. **This repo's own path can stay on the Windows filesystem** and be
   referenced from WSL via `/mnt/c/...` — e.g.
   `-ccp /mnt/c/Users/<you>/.../chaincode`. `peer lifecycle chaincode
   package` reads it fine across the WSL/Windows filesystem boundary.

With these in place, `entrypoint.sh`'s flow (network up, channel creation,
both peers joining `canal-str`, chaincode packaging) ran correctly.

## Remaining blocker at time of writing: Docker Engine version

Chaincode *packaging* succeeded, but chaincode *install* (which needs
Docker to build an image to actually run the chaincode) failed with:

```
Error: chaincode install failed with status: 500 - failed to invoke backing
implementation of 'InstallChaincode': could not build chaincode: docker
build failed: docker image inspection failed: Error response from daemon:
client version 1.52 is too new. Maximum supported API version is 1.41
```

The actual Docker Engine on this machine (confirmed by querying the socket
directly: `curl --unix-socket /var/run/docker.sock http://localhost/version`)
was `20.10.17`, API `1.41` — a 2022-era release. Fabric 2.5.16's peer binary
needs Docker API ~`1.52`, and its bundled Docker client **does not honor**
the `DOCKER_API_VERSION` environment variable the way the `docker` CLI
does — setting it on the peer container (confirmed present via
`docker exec peer0.org1.example.com env`) made no difference to this error.

**Fix**: update Docker Desktop to a current version. There is no viable
workaround short of that. This is a hard version floor, not a
configuration issue.

## After Docker Desktop was updated: two more (non-Windows-specific) bugs

Once the Docker Engine version was no longer the blocker, deploying for
real surfaced two actual code bugs in this repo - not Windows issues, they'd
happen identically on Linux, just never got caught until something actually
tried to run the chaincode/client live. Covered in the main
[README's "Known gaps"](../README.md#known-gaps) section rather than
repeated here: `chaincode/package.json` was missing the `fabric-shim`
dependency and `"start"` script the chaincode container needs to actually
launch, and `server.js` assumed a Fabric CA that `entrypoint.sh` never
starts. Both are fixed now, but it's worth calling out that neither the
unit test suite (which mocks `ctx.stub` and never runs a real chaincode
container) nor static review caught either one - only an actual deploy did.

## Summary checklist for next time

1. Don't use Git Bash for the live network — use WSL2.
2. If Ubuntu's WSL image fails to start (`E_UNEXPECTED`), try Debian.
3. Enable Docker Desktop's WSL integration for whichever distro you use.
4. `apt-get install -y curl git jq` before running `entrypoint.sh`.
5. Run `install-fabric.sh` inside the Linux distro, not reused from Windows.
6. Make sure Docker Desktop is reasonably current (this class of "API
   version too new" error means it isn't).
