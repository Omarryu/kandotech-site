/* ==========================================================================
   KANDOTECH — checkout configuration
   Default assumes you're running the unified backend in server/backend
   (see README.md). If you deploy the storefront and API separately, or use
   the standalone Netlify/Vercel checkout-only functions instead, update
   this path accordingly.
   ========================================================================== */

const CHECKOUT_CONFIG = {
  createSessionEndpoint: "/api/create-checkout-session",
};
