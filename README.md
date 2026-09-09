# StartupForge API server

This Express service provides the MongoDB-backed API used by the StartupForge Next.js client.

## Stack

- Node.js and Express
- MongoDB
- Better Auth JWT verification through the configured JWKS endpoint
- Stripe transaction integration

## Local setup

1. Install Node.js 20 or newer.
2. Install dependencies: `npm install`
3. Create `.env` with:

```env
PORT=5000
MONGODB_URI=
DB=startupforge
JWKS=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
CLIENT_ORIGIN=http://localhost:3000
JWT_ISSUER=
JWT_AUDIENCE=
JWT_ALGORITHMS=EdDSA
```

4. Start the server: `npm start`
5. Confirm it responds at `http://localhost:5000/`.

## API areas

- Public startup and opportunity browsing
- Authenticated startup, opportunity, application, and profile operations
- Authenticated payment recording and personal transactions
- Admin-only users, startup moderation, transaction, and statistics endpoints

All private endpoints require a Better Auth JWT in the `Authorization: Bearer <token>` header. Admin endpoints additionally require the `admin` role. Payment records are stored in MongoDB and are intended to be written only after verified Stripe payment fulfillment.

## Security

Do not commit `.env` files or credentials. Configure Stripe to deliver signed events to `/api/stripe/webhook`; payment fulfillment is performed only after signature verification. Configure CORS to the deployed client origin instead of allowing every origin in production.
