# BlockShield

## Serverless Edge Security & API Gateway Built with Cloudflare

BlockShield is a serverless API security gateway running on Cloudflare's edge network.

## Note
BlockShield is not meant to represent a complete end-user application on its own. It is a reusable security and edge-infrastructure layer designed to sit in front of real full-stack applications as they scale. The same authentication, request signing, rate limiting, bot protection, and asynchronous security logging patterns used here can be integrated into my other projects to protect public APIs and expensive backend services before requests reach the core application.


Live: https://blockshield.nirajanbanjade.workers.dev

It protects API requests before compute is executed using API-key authentication, HMAC-SHA256 request signing, timestamp validation, distributed rate limiting, Cloudflare Turnstile, asynchronous security logging, and D1 persistence.

## Architecture

                         Client
                           |
                           v
                 +-------------------+
                 | Cloudflare Worker |
                 |    API Gateway    |
                 +-------------------+
                           |
              +------------+------------+
              |            |            |
              v            v            v
          Validation   API Key       HMAC
                       /Turnstile    Signature
              |            |            |
              +------------+------------+
                           |
                           v
                 +-------------------+
                 |  Durable Object   |
                 |   Rate Limiter    |
                 +-------------------+
                           |
                       Allowed?
                       /      \
                     NO        YES
                     |          |
                 429 Block      v
                         +-------------+
                         |   Compute   |
                         +-------------+
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
                Response                  Queue
                                            |
                                            v
                                      Log Consumer
                                            |
                                            v
                                           D1

## Request Flow

Developer requests use:

POST /api/v1/analyze

Example:

{
  "numbers": [10, 20, 30]
}

Incoming Request
       |
       v
Validate Input
       |
       v
Authenticate Client
       |
       v
Verify HMAC Signature
       |
       v
Validate Timestamp
       |
       v
Distributed Rate Limit
       |
   +---+---+
   |       |
 BLOCK    ALLOW
           |
           v
       Compute
           |
           v
       Response
           |
           +------> Security Queue
                         |
                         v
                        D1

The API returns count, sum, average, minimum, and maximum. The computation is intentionally simple; the project focuses on protecting and controlling access to compute.

## Core Features

### Edge Compute

Cloudflare Workers provide the main request-processing and compute layer.

Client → Cloudflare Edge → Worker → Security → Compute

Requests are validated and filtered at the edge before application logic executes.

### API-Key Authentication

Developer clients authenticate using:

X-API-Key

API Key
   |
   v
Worker
   |
   +---- Valid ------> Continue
   |
   +---- Invalid ----> 401 Unauthorized

Production credentials are stored using Cloudflare Worker Secrets.

### HMAC-SHA256 Request Signing

The client signs:

timestamp + requestBody

Conceptually:

HMAC_SHA256(secret, timestamp + requestBody)

Requests include:

X-API-Key
X-Timestamp
X-Signature

The Worker independently generates the expected signature and compares it with the client signature.

Client Signature
       |
       v
Worker Recalculates
       |
    +--+--+
    |     |
 MATCH   FAIL
    |     |
 ALLOW   BLOCK

### Timestamp Validation

Signed requests include a timestamp. Requests outside the configured five-minute window are rejected.

Current Time:       10:10
Request Timestamp:  10:02
Difference:         8 minutes
Allowed Window:     5 minutes

Result: BLOCK

This limits reuse of old captured requests.

Full one-time replay prevention would additionally require storing and rejecting previously used nonces or request IDs.

### Distributed Rate Limiting

Each client is limited to:

10 requests / 60 seconds

Cloudflare Durable Objects maintain shared rate-limit state.

### Turnstile Bot Protection

The browser-facing API uses Cloudflare Turnstile.

Browser
   |
   v
Turnstile
   |
   v
POST /api/analyze
   |
   v
Worker Verification
   |
   +---- Invalid ---> BLOCK
   |
   +---- Valid -----> Continue

The Worker validates the token, expected hostname, and analyze action server-side.

### Asynchronous Security Logging

Security logging is kept off the main request path using Cloudflare Queues.

API Worker
   |
   +------> Response
   |
   +------> Queue
              |
              v
         Log Consumer
              |
              v
             D1

This decouples request processing from security-event persistence.

### Security Events

Important security decisions generate events such as:

ALLOWED
INVALID_API_KEY
INVALID_SIGNATURE
RATE_LIMITED
REPLAY_DETECTED
INVALID_INPUT
TURNSTILE_FAILED

Example:

{
  "client_id": "client_123",
  "endpoint": "/api/v1/analyze",
  "status": "BLOCKED",
  "reason": "RATE_LIMITED",
  "timestamp": "2026-08-09T15:32:14Z"
}

Events are sent through Cloudflare Queues and stored in D1.

## API Endpoints

Method

Endpoint

Purpose

Protection

GET

/

Browser number analyzer

Turnstile on submission

GET

/api/config

Public Turnstile configuration

Public

POST

/api/analyze

Browser API

Turnstile + IP rate limit

POST

/api/v1/analyze

Developer API

API key + HMAC + timestamp + rate limit

## Cloudflare Stack

Workers — main API gateway and compute runtime.

Durable Objects — shared state for distributed rate limiting.

Queues — asynchronous security-event processing.

D1 — SQLite-based serverless database for security events.

Turnstile — protects the browser-facing endpoint from automated abuse.

Worker Secrets — stores API keys, signing secrets, and Turnstile configuration.

## Attack Simulator

BlockShield includes a Node.js attack simulator for testing the developer API.

Start the Worker:

npm run dev

Run simulations:

npm run simulate -- burst
npm run simulate -- invalid-key
npm run simulate -- bad-signature
npm run simulate -- missing-signature
npm run simulate -- stale-timestamp
npm run simulate -- replay
npm run simulate -- invalid-json
npm run simulate -- invalid-input
npm run simulate -- method-not-allowed

The default burst test sends 25 signed requests. With a fresh rate-limit window:

Request 1  -> 200 OK
...
Request 10 -> 200 OK
Request 11 -> 429 RATE LIMITED
...
Request 25 -> 429 RATE LIMITED

Summary
----------------
Allowed: 10
Blocked: 15

## Testing

The automated suite contains 12 tests covering:

Security-event creation and D1 persistence

Turnstile configuration and validation failures

Successful browser analysis

10-request-per-minute rate limiting

Missing API keys

Invalid HMAC signatures

Stale timestamps

Successful signed developer requests

Run:

npm test -- --run
npm run types

## Local Development

npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev

## Deployment

Authenticate and configure secrets:

npx wrangler login
npx wrangler secret put API_KEY
npx wrangler secret put API_SECRET
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put TURNSTILE_SITE_KEY
npx wrangler secret put TURNSTILE_EXPECTED_HOSTNAME

Apply migrations and validate:

npm run db:migrations:list
npm run db:migrate:remote
npm run types
npm test -- --run
npx wrangler deploy --dry-run
npm run deploy

Monitor production:

npx wrangler tail

## Project Structure

BlockShield/
│
├── src/
│   ├── index.js
│   ├── auth.js
│   ├── security.js
│   ├── compute.js
│   ├── rateLimiter.js
│   └── queueConsumer.js
├── migrations/
├── simulator/
│   └── attack.js
├── test/
├── wrangler.jsonc
├── package.json
└── README.md

## Production Status

[x] Cloudflare Worker API
[x] Browser interface
[x] Developer API
[x] API-key authentication
[x] HMAC-SHA256 request signing
[x] Timestamp validation
[x] Durable Object rate limiting
[x] Turnstile protection
[x] Queue-based security logging
[x] D1 event persistence
[x] Attack simulator
[x] Automated security tests
[ ] Security dashboard

Production smoke testing verified:

Valid signed request   -> 200
Unsigned request       -> 401
Rate-limit violation   -> 429
Security event         -> Queue
Queue consumer         -> D1

## Tech Stack

JavaScript
Node.js
Cloudflare Workers
Cloudflare Durable Objects
Cloudflare Queues
Cloudflare D1
Cloudflare Turnstile
HMAC-SHA256
Wrangler
Vitest
Git / GitHub

## Project Goal

BlockShield demonstrates an edge-native architecture where API traffic can be authenticated, validated, rate limited, processed, and monitored without maintaining a traditional backend server.

The project combines edge computing, API security, distributed coordination, asynchronous processing, and serverless storage using the Cloudflare developer platform.
