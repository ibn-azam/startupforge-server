# StartupForge API Server

The Express + MongoDB backend for **StartupForge** — a platform connecting startup founders with collaborators (developers, designers, marketers). This service powers the [https://startupforge-blush.vercel.app](https://github.com/ibn-azam), exposing role-based endpoints for founders, collaborators, and admins.

## Stack

- **Runtime:** Node.js + Express 5
- **Database:** MongoDB (native driver)
- **Auth:** Better Auth JWT verification via JWKS (`jose`)
- **Payments:** Stripe (checkout + webhooks)
- **Hosting:** Vercel (serverless functions)

## Features

- Public browsing of startups and opportunities
- Authenticated startup, opportunity, application, and profile management
- Collaborator applications to open opportunities
- Stripe-backed payment recording and personal transaction history
- Admin-only endpoints for user management, startup moderation, transactions, and platform statistics
- Role-aware access control (`founder`, `collaborator`, `admin`) enforced from the JWT payload

## Getting Started

### Prerequisites

- Node.js 20+
- A MongoDB Atlas cluster (or local MongoDB instance)
- A Stripe account (test mode is fine for local dev)
- A running instance of the StartupForge client with Better Auth configured (for JWKS)








## API Overview

All private routes require a Better Auth JWT in the request header:

```
Authorization: Bearer <token>
```

Admin routes additionally require the authenticated user's role to be `admin`.

| Area | Access | Notes |
|---|---|---|
| Startups & opportunities (browse) | Public | Read-only listing/search endpoints |
| Startups, opportunities, applications, profile | Authenticated | Scoped to the requesting user |
| Payments & transactions | Authenticated | Records are written only after Stripe payment fulfillment is verified |
| Users, startup moderation, transactions, stats | Admin | Requires `admin` role in the JWT-derived user record |

## Security Notes

- Never commit `.env` files or credentials.
- Stripe webhooks are delivered to `/api/stripe/webhook`; payment records are only written after signature verification.
- In production, set `CLIENT_ORIGIN` to the deployed client URL rather than allowing all origins.
- Ensure MongoDB Atlas network access permits Vercel's serverless IP ranges (`0.0.0.0/0` if IPs aren't static).

## Deployment

Configured for deployment on Vercel as serverless functions (see `vercel.json`). Set the environment variables above in the Vercel project settings before deploying.