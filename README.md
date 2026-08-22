# Fund Transfer System - Decentralized Infrastructure PoC

This repository holds the proof-of-concept code from the bachelor's thesis
**"Sistema de Transferência de Fundos: Adoção de uma Infraestrutura
Descentralizada pelo Banco Central"** ("Fund Transfer System: Adoption of a
Decentralized Infrastructure by the Central Bank"), by Gabriel
Orofino, Centro Universitário Ibmec/RJ, 2022 (advisor: Prof. Me. Victor
Machado da Silva).

## Context

Brazil's Reserve Transfer System (**STR** - *Sistema de Transferência de
Reservas*), operated by the Central Bank of Brazil (BCB), settles the
country's financial obligations via real-time gross settlement (RTGS). The
thesis reviews the literature on central banks adopting blockchain / DLT
infrastructure, and argues that a private/permissioned blockchain could
improve auditability, reduce intermediaries, and increase settlement
efficiency and transparency - while acknowledging real barriers: legacy
system replacement costs, irrevocability of transactions, and skepticism
that DLT settlement can match current RTGS speed.

To test the idea at a small scale, the thesis builds a proof of concept
using **Hyperledger Fabric** that models a simplified two-organization STR
channel and demonstrates a fund transfer between two economic agents.This
codebase is the practical artifact described in section 3.6 ("Proposta de
Implementação").

## What's in this repo

- [functions.js](functions.js) - the `AssetTransfer` chaincode contract
  (Fabric Contract API), reproduced verbatim from the thesis's Figure 14
  ("Código Javascript modificado"):
  - `InitLedger` - seeds the ledger with six sample assets/balances
  - `CreateAsset(id, owner, appraisedValue)` - creates a new ledger entry
  - `TransferAsset(id, newOwner, value)` - represents a transfer as a debit
    entry and a credit entry (see **Simplifying hypothesis** below)
  - `GetAllAssets` - returns every entry currently on the ledger
- [entrypoint.sh](entrypoint.sh) - the exact command sequence from section
  3.6: installs Hyperledger Fabric, brings up the `test-network` sample,
  creates the `canal-str` channel, deploys `functions.js` as the `basico`
  chaincode, and invokes/queries a transfer between two of the seeded
  accounts (Adriana → Michel)
- [Dockerfile](Dockerfile) / [docker-compose.yml](docker-compose.yml) -
  unfinished scaffolding, not part of the thesis's documented flow (see
  **Known gaps**)
- [package.json](package.json) / [yarn.lock](yarn.lock) - Node manifest
  declaring the `fabric-network` SDK dependency

## Running the PoC

Prerequisites: Docker, `curl`, and a Linux-like shell (the thesis used
Ubuntu 20.04 LTS on a Linode instance).

```bash
yarn install
```

Then follow [entrypoint.sh](entrypoint.sh) - it installs Fabric's samples,
binaries and Docker images, stands up `test-network`, creates the
`canal-str` channel, deploys `functions.js` as chaincode `basico`, and runs
`InitLedger`, `GetAllAssets`, and a `TransferAsset` invocation. It is a
reference/runbook script (as in the thesis), not meant to be executed
unattended.

## Simplifying hypothesis (from the thesis)

The proof of concept adopts one simplification, stated explicitly in
section 3.6: the ledger entries produced by `InitLedger` represent each
client's **total balance**, not individual transactions. A transfer is
modeled as two new `CreateAsset` calls - a debit for the sender and a
credit for the recipient - rather than mutating the sender/recipient's
existing balance in place.

## Known gaps

These are gaps between the thesis's described/intended behavior and what
the checked-in code actually does - kept as-is (not patched) so the repo
matches the thesis submission ipsis literis:

- **`TransferAsset` returns an undefined variable.** `return oldOwner;`
  references a variable that's never declared in the function, so the call
  throws a `ReferenceError` - after the two `CreateAsset` writes have
  already been applied to the ledger. Running the `TransferAsset` step in
  `entrypoint.sh` will report an invocation error even though the
  underlying state change succeeds.
- **The two debit/credit entry IDs are hardcoded** (`'e0162780-2afc-46c8'`,
  `'43b6d8d5-a347-4521'`) instead of generated per transaction. Since
  `CreateAsset` rejects an ID that already exists, a second `TransferAsset`
  call will fail with "asset already exists."
- **`package.json` declares `"main": "server.js"`** and depends on the
  `fabric-network` SDK, but no `server.js` exists. The thesis explicitly
  chose native `peer chaincode` CLI commands over an SDK-based client for
  this demonstration ("serão utilizados os comandos nativos"), so this
  dependency/entry point looks like unfinished groundwork for an SDK-driven
  client that was never built.
- **`Dockerfile` and `docker-compose.yml` are empty/near-empty** and are
  not part of the setup path in `entrypoint.sh`. The thesis's flow
  provisions containers via `install-fabric.sh` pulling `fabric-samples`,
  whose own `test-network` docker-compose files do the real container
  orchestration - these top-level files were an unfinished attempt at
  something else (likely containerizing the setup script itself).

## Future work (from the thesis's closing remarks)

The thesis's "Considerações Finais" suggests these extensions:

- Deepen Fabric's configuration options to reflect real sectors of the
  Brazilian National Financial System, building on the two-participant
  channel shown here.
- Generalize the channel from two participants to **n agents**, each with
  different read/write permissions on the shared ledger.
- Introduce **anchor nodes operated by the Central Bank** to guarantee
  stability and redundancy of operations on the network.

## Reference

Orofino, G. L. *Sistema de Transferência de Fundos: adoção de uma
infraestrutura descentralizada pelo Banco Central*. Trabalho de Conclusão
de Curso (Graduação em Ciências Econômicas) - Centro Universitário Ibmec,
Rio de Janeiro, 2022.
