# BlockShield

### A Serverless Edge Security and Compute Gateway Built with Cloudflare

## 1. Project Overview

**BlockShield** is a lightweight serverless API gateway that runs on Cloudflare's edge network.

**Live application:** [blockshield.nirajanbanjade.workers.dev](https://blockshield.nirajanbanjade.workers.dev)

The current deployment uses the Cloudflare Workers Free plan. It was deployed and
smoke-tested on August 13, 2026.

The goal of the project is to explore how a modern application can perform **compute, authentication, rate limiting, security monitoring, and asynchronous processing without maintaining a traditional backend server**.

Instead of allowing clients to directly access an API, every request first passes through a Cloudflare Worker.

The Worker acts as a security and compute layer:

```text
Client
   |
   v
Cloudflare Edge
   |
   v
Cloudflare Worker
   |
   +---- Authentication
   |
   +---- Request Validation
   |
   +---- Rate Limiting
   |
   +---- Compute
   |
   +---- Security Logging
   |
   v
Response
```

Cloudflare Workers are a serverless platform for deploying applications across Cloudflare's global network, and JavaScript is directly supported by the Workers runtime.

---

# 2. Why I Am Building BlockShield

Modern applications expose APIs to users, mobile applications, internal services, and other systems.

Exposing an API directly introduces several problems:

* A malicious user may send thousands of requests.
* Attackers may attempt to use stolen or invalid API credentials.
* Automated bots may abuse public endpoints.
* Expensive compute endpoints may be repeatedly called.
* Logging every request synchronously can slow down the API.
* Running and maintaining a traditional backend server adds infrastructure complexity.

BlockShield explores how these problems can be handled **at the edge before requests reach more expensive application infrastructure**.

The project is also designed as a practical way to learn three areas:

### Edge Compute

Run application logic using Cloudflare Workers without managing a traditional server.

### Application Security

Implement authentication, request validation, rate limiting, replay protection, and bot protection.

### Distributed Systems

Use distributed state, message queues, and serverless databases to coordinate requests and process security events.

The goal is therefore not simply to create another REST API.

The goal is to answer:

> **How can an API be protected and controlled using serverless infrastructure running at the edge?**

---

# 3. What BlockShield Does

A developer client sends a request to BlockShield:

```text
POST /api/v1/analyze
```

Example:

```json
{"numbers": [10, 20, 30]}
```

The request does not immediately execute the compute operation.

It first goes through a security pipeline.

```text
                    Incoming Request
                           |
                           v
                    Cloudflare Worker
                           |
                    Validate Request
                           |
                           v
                    Check API Key
                       /       \
                  Invalid      Valid
                     |           |
                   BLOCK         v
                           Verify Signature
                                 |
                                 v
                            Rate Limiter
                             /       \
                          BLOCK      ALLOW
                                      |
                                      v
                               Execute Compute
                                      |
                                      v
                               Return Response
                                      |
                                      v
                              Security Queue
                                      |
                                      v
                                      D1
```

---

# 4. Core Features

## 4.1 Edge Compute API

Cloudflare Workers execute the main application logic.

The first version exposes:

```text
POST /api/analyze
POST /api/v1/analyze
```

The current computation accepts a non-empty array of finite numbers and returns:

* Count
* Sum
* Average
* Minimum
* Maximum

The compute operation itself is intentionally simple.

The important part of the project is controlling **who can execute the computation and how frequently they can execute it**.

---

# 4.2 API Authentication

Clients receive an API key.

Example request:

```text
POST /api/v1/analyze

X-API-Key: abc123
```

The Worker checks whether the supplied key is valid.

```text
API Key
   |
   v
Worker
   |
   +---- Valid ------> Continue
   |
   +---- Invalid ----> 401 Unauthorized
```

Sensitive credentials are stored using Cloudflare Worker secrets rather than hard-coded inside the application.

---

# 4.3 Signed Requests

API keys identify the client, and BlockShield provides additional protection using request signatures.

The client generates an HMAC signature using:

```text
API Secret
+
Timestamp
+
Request Body
```

For example:

```text
signature =
HMAC_SHA256(secret, timestamp + requestBody)
```

The request contains:

```text
X-API-Key
X-Timestamp
X-Signature
```

The Worker independently calculates the signature.

```text
Client signature
       |
       v
Compare with
Worker-generated signature
       |
     /   \
 match   mismatch
   |        |
ALLOW      BLOCK
```

This helps demonstrate authenticated API requests rather than simply checking whether a static key exists.

---

# 4.4 Replay Protection

An attacker could capture a valid signed request and send it again.
To reduce this risk, BlockShield checks the timestamp.
For example:

```text
Current time:       10:10:30
Request timestamp:  10:02:00

Difference: 8 minutes

Allowed window: 5 minutes

Result: BLOCK
```

The Worker rejects requests outside the permitted time window.

---
# 4.5 Distributed Rate Limiting

Every API client receives a request limit.

BlockShield currently allows 10 requests per client in a 60-second window. A Cloudflare
Durable Object stores the counter so requests handled at different edge locations share
the same limit.

---

# 5. Current Implementation

The current Worker provides two protected entry points:

* `POST /api/analyze` is intended for the browser interface. It verifies a Turnstile
  token, rate limits by client IP, analyzes the submitted numbers, and records a security
  event.
* `POST /api/v1/analyze` is intended for developer clients. It verifies an API key, a
  SHA-256 HMAC signature, and a timestamp before applying the rate limit and running the
  analysis.

Security events are sent to `SECURITY_EVENTS`. The Queue consumer writes them to the D1
database bound as `DB`. Rate-limit state is stored by the `RATE_LIMITER` Durable Object.

## 5.1 Available endpoints

| Method | Endpoint | Purpose | Protection |
| --- | --- | --- | --- |
| `GET` | `/` | Browser-based number analyzer | Turnstile on submission |
| `GET` | `/api/config` | Returns the public Turnstile site key | Public configuration only |
| `POST` | `/api/analyze` | Browser analysis API | Turnstile and IP rate limit |
| `POST` | `/api/v1/analyze` | Developer analysis API | API key, HMAC, timestamp, and rate limit |

## 5.2 Production status

The production deployment currently has:

* A managed Turnstile widget restricted to `blockshield.nirajanbanjade.workers.dev`
* Five configured Worker secrets: `API_KEY`, `API_SECRET`, `TURNSTILE_SECRET`,
  `TURNSTILE_SITE_KEY`, and `TURNSTILE_EXPECTED_HOSTNAME`
* D1 migration `0001_create_security_events.sql` applied remotely
* Queue producer and consumer connected to `edgeshield-security-events`
* SQLite-backed `RateLimiter` Durable Object deployed
* Worker preview URLs disabled; the explicit `workers.dev` route remains enabled

The production smoke test confirmed that a valid signed request returned the expected
analysis, an unsigned request returned `401`, and both the allowed and blocked events
were delivered through the Queue and stored in D1.

---

# 6. Local Development

Copy `.dev.vars.example` to `.dev.vars` and keep `.dev.vars` out of version control.
The example uses Cloudflare's public Turnstile test credentials.

```text
npm install
npm run db:migrate:local
npm run dev
```

Run the checks with:

```text
npm test -- --run
npm run types
```

---

# 7. Production Deployment and Maintenance

The first production deployment is complete. The instructions below describe how to
reproduce or maintain it.

## 7.1 Turnstile

The deployed widget is named `BlockShield Production` and is restricted to
`blockshield.nirajanbanjade.workers.dev`. BlockShield loads its public site key from
`GET /api/config`; the key is not hard-coded in the page. The Worker validates both the
token hostname and the `analyze` action on the server.

## 7.2 Required secrets

Authenticate Wrangler, then configure the five environment-specific values. Although a
Turnstile site key and hostname are public information, they are stored as bindings here
so a deployment cannot accidentally use the local test configuration.

```text
npx wrangler login
npx wrangler secret put API_KEY
npx wrangler secret put API_SECRET
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_EXPECTED_HOSTNAME
npx wrangler secret list
```

Use a randomly generated value for `API_SECRET`. Never commit any of these production
values.

## 7.3 Cloudflare resources

The Wrangler configuration expects:

* D1 database: `edgeshield-db`
* Queue: `edgeshield-security-events`
* Durable Object binding: `RATE_LIMITER`, backed by the exported `RateLimiter` class

Confirm that the D1 ID in `wrangler.jsonc` belongs to the intended account and that the
Queue exists. The current D1 database ID is already configured. Create the Queue only
when reproducing the deployment in another account and it is missing:

```text
npx wrangler d1 list
npx wrangler queues list
npx wrangler queues create edgeshield-security-events
```

## 7.4 Database and deployment

D1 changes are stored as numbered files in `migrations/`. Check and apply the remote
migrations before deploying the Worker:

```text
npm run db:migrations:list
npm run db:migrate:remote
npm run types
npm test -- --run
npx wrangler deploy --dry-run
npm run deploy
```

After deployment, verify the browser flow, signed developer API, rate limiting, Queue
consumption, and D1 rows. Use `npx wrangler tail` to observe live Worker and Queue
activity.

---

# 8. Verification

The Worker test suite currently contains 12 passing tests covering:

* Security-event creation, D1 persistence, and summary queries
* Public Turnstile configuration
* Missing, invalid, and wrong-hostname Turnstile tokens
* Successful browser analysis
* The 10-request-per-minute rate limit
* Missing API keys and invalid signatures
* Stale request timestamps
* Successful signed developer requests

Run it with:

```text
npm test -- --run
```

Production credentials cannot be read back from Cloudflare. If a developer API key or
secret is lost, rotate it with `npx wrangler secret put API_KEY` or
`npx wrangler secret put API_SECRET` and update the authorized client securely.

After deployment, verify the browser flow, signed developer API, rate-limit response,
Queue consumption, and stored D1 rows. `npx wrangler tail` can be used while sending the
smoke-test requests.

Example:

```text
API Key: client_123

Limit:
10 requests / minute
```

Cloudflare Durable Objects can maintain the state associated with each client.
Durable Objects combine compute with persistent storage and provide a globally unique coordination point, making them useful when requests need shared state rather than independent stateless processing.

Conceptually:

```text
client_123
     |
     v
Durable Object
     |
requests = 8
limit    = 10
     |
     v
ALLOW
```

Once the limit is exceeded:

```text
requests = 11
limit    = 10

429 Too Many Requests
```

---

# 4.6 Security Event Logging

Every important security decision creates an event.

Examples include:

```text
ALLOWED
INVALID_API_KEY
INVALID_SIGNATURE
RATE_LIMITED
REPLAY_DETECTED
INVALID_INPUT
TURNSTILE_FAILED
```

An event might look like:

```json
{
    "client_id": "client_123",
    "endpoint": "/api/v1/analyze",
    "status": "BLOCKED",
    "reason": "RATE_LIMITED",
    "timestamp": "2026-08-09T15:32:14Z"
}
```

These events are stored so that API activity can later be analyzed.

---

# 4.7 Asynchronous Security Logging

The API should not need to wait for every security log to be stored before returning a response.

Instead:

```text
API Worker
    |
    +------> Response to Client
    |
    +------> Cloudflare Queue
                    |
                    v
              Log Consumer
                    |
                    v
                    D1
```

Cloudflare Queues integrates with Workers and is designed for asynchronous message processing, including offloading work from a request and buffering or batching events. It is available on Workers Free.

This introduces an important distributed-systems concept:

**decoupling the user request from background event processing.**

---

# 5. Security Database

Cloudflare D1 will store security events and information about API clients.

D1 is Cloudflare's managed serverless SQL database built around SQLite semantics and can be accessed directly from Workers through bindings.

Possible database tables:

```text
api_clients
-------------------
id
name
api_key_hash
created_at
enabled


security_events
-------------------
id
client_id
endpoint
status
reason
timestamp
```

Example query:

```sql
SELECT reason, COUNT(*)
FROM security_events
WHERE status = 'BLOCKED'
GROUP BY reason;
```

This could produce:

```text
RATE_LIMITED            142
INVALID_API_KEY          57
INVALID_SIGNATURE        31
REPLAY_DETECTED          12
```

---

# 9. Attack Simulator

The Node.js attack simulator exercises the developer API against a running local Worker.
It reads `API_KEY` and `API_SECRET` from `.dev.vars` unless those variables are already
set in the environment.

Start the Worker in one terminal:

```bash
npm run dev
```

Run a simulation in another terminal:

```bash
npm run simulate -- burst
npm run simulate -- invalid-key
npm run simulate -- bad-signature
npm run simulate -- missing-signature
npm run simulate -- stale-timestamp
npm run simulate -- replay
npm run simulate -- invalid-json
npm run simulate -- invalid-input
npm run simulate -- method-not-allowed
```

`burst` sends 25 valid signed requests by default. In a fresh rate-limit window, the
first 10 are allowed and the remaining 15 are rate limited. Earlier requests made with
the same API key during that minute reduce the number allowed by the simulation. Set
`BLOCKSHIELD_BURST_COUNT` to change the request count. Set `BLOCKSHIELD_URL` to target
another deployment; it defaults to `http://localhost:8787`.

The `replay` mode intentionally shows the current replay-window behavior. An identical
request replayed immediately is accepted because the timestamp remains fresh, while a
request signed with a timestamp older than five minutes is rejected. Full one-time
replay prevention would require storing and rejecting previously used nonces or request IDs.

Example:

```text
$ npm run simulate -- burst

Sending 25 requests...

Request 1  -> 200 OK
Request 2  -> 200 OK
Request 3  -> 200 OK
...
Request 10 -> 200 OK
Request 11 -> 429 RATE LIMITED
Request 12 -> 429 RATE LIMITED
Request 13 -> 429 RATE LIMITED

Summary
----------------
Allowed: 10
Blocked: 15
```

---

# 10. Optional Security Dashboard

A small web interface can show activity collected by the system.

```text
------------------------------------------------
                 BlockShield
------------------------------------------------

Requests                                1,284

Allowed                                   952
Blocked                                   332


Blocked Requests
------------------------------------------------

Rate Limit Exceeded                       192
Invalid API Key                            74
Invalid Signature                          48
Replay Attempt                             18


Recent Events
------------------------------------------------

09:42:13   RATE_LIMIT          BLOCKED
09:42:11   INVALID_KEY         BLOCKED
09:42:03   /api/v1/analyze     ALLOWED
09:41:58   REPLAY              BLOCKED
```

The dashboard is secondary to the project.

The core project should work completely through the API before the dashboard is built.

---

# 8. Technology Stack

## Cloudflare

### Cloudflare Workers

Main compute and request-processing layer.

```text
Request
   |
   v
Worker
   |
Security + Compute
```

Workers provide the serverless execution environment for the project.

### Durable Objects

Used for stateful rate limiting.

```text
API Key
   |
   v
Durable Object
   |
Request Counter
```

Durable Objects are currently available on Workers Free as well as Workers Paid.

### Cloudflare Queues

Used for asynchronous security-event processing.

```text
Worker → Queue → Consumer
```

Queues can decouple the request-processing Worker from the logging component.

### Cloudflare D1

Stores API-client metadata and security events.

```text
Queue Consumer
      |
      v
      D1
```

D1 is available on the Workers Free plan.

### Worker Secrets

Used for sensitive application configuration and cryptographic secrets.

### Cloudflare Turnstile — Optional

Can later protect the dashboard or API-key registration interface from automated abuse.

---

# 11. Development Tools

The project will primarily use:

```text
JavaScript
    |
Cloudflare Workers
    |
Wrangler CLI
    |
Cloudflare
```

Cloudflare's official CLI for creating, developing, configuring, and deploying Workers is **Wrangler**.

Local tools:

```text
Node.js
npm
Wrangler
Git
GitHub
VS Code
```

---

# 12. Project Structure

```text
BlockShield/
│
├── src/
│   │
│   ├── index.js
│   │
│   ├── auth.js
│   │
│   ├── security.js
│   │
│   ├── compute.js
│   │
│   └── rateLimiter.js
│   │
│   └── queueConsumer.js
│
├── database/
│   └── schema.sql
│
├── simulator/
│   └── attack.js
│
├── public/
│   └── dashboard/
│
├── wrangler.jsonc
│
├── package.json
│
└── README.md
```

---

# 13. Full System Architecture

```text
                      INTERNET
                         |
                         |
                         v
                +------------------+
                | Cloudflare Edge  |
                +------------------+
                         |
                         v
                +------------------+
                |      Worker      |
                |   API Gateway    |
                +------------------+
                         |
              +----------+----------+
              |          |          |
              v          v          v
          Validate     Auth       HMAC
          Request      Check      Verify
              |          |          |
              +----------+----------+
                         |
                         v
                +------------------+
                | Durable Object   |
                |   Rate Limiter   |
                +------------------+
                         |
                    Allowed?
                    /       \
                  NO         YES
                  |           |
               429            v
                        +-------------+
                        |   Compute   |
                        +-------------+
                              |
                    +---------+---------+
                    |                   |
                    v                   v
                Response              Queue
                                         |
                                         v
                                  +--------------+
                                  | Log Consumer |
                                  +--------------+
                                         |
                                         v
                                    +---------+
                                    |   D1    |
                                    +---------+
```

---

# 12. MVP Status

The first working version is deployed.

Current status:

```text
[x] Cloudflare Worker API

[x] /api/analyze browser endpoint

[x] /api/v1/analyze developer endpoint

[x] API-key authentication

[x] HMAC request signing

[x] Timestamp/replay-window validation

[x] Durable Object rate limiter

[x] Queue security events

[x] Store events in D1

[x] Turnstile-protected browser interface

[ ] Security dashboard

[x] JavaScript attack simulator
```

The API foundation, Turnstile integration, and attack simulator are complete. The
security dashboard remains an optional next step.

---

# 14. What I Want to Learn

By building BlockShield, I want to understand:

* How edge computing differs from traditional backend deployment.
* How serverless Workers process HTTP requests.
* How authentication works at an API gateway.
* How HMAC signatures can protect API requests.
* How replay attacks can be detected.
* How distributed rate limiting requires shared state.
* How Durable Objects coordinate state.
* How message queues decouple services.
* How asynchronous processing improves system architecture.
* How security events can be collected and analyzed.
* How serverless databases integrate with compute services.
* How multiple Cloudflare services can work together as one distributed application.

---

# 14. Project Goal

BlockShield is not intended to replace a production API-management or enterprise security platform.

It is an educational implementation of the fundamental ideas behind one:

```text
                    BlockShield

            Compute       Security
                \           /
                 \         /
                  \       /
               Cloudflare Edge
                      |
              Distributed State
                      |
               Async Processing
                      |
               Security Data
```

The final project demonstrates how **compute, distributed systems, and application security can be combined into a small serverless system running almost entirely on Cloudflare's developer platform.**
