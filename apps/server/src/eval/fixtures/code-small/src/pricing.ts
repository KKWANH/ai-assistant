// pricing.ts — cart pricing helpers for the orders subsystem.
//
// Every function here is pure: callers pass the cart plus the active tier
// table and get back integer cent amounts. Rounding is deferred to the very
// end of a discount calculation so the intermediate arithmetic can stay in
// plain floating cents without compounding rounding error along the way.

interface CartLine {
  quantity: number;
  unitPriceCents: number;
}

interface Cart {
  lines: CartLine[];
  customer: { lifetimeSpendCents: number };
}

interface Tier {
  minLifetimeSpendCents: number;
  percentOff: number;
}

export function cartSubtotal(cart: Cart): number {
  let total = 0;
  for (const line of cart.lines) {
    total += line.quantity * line.unitPriceCents;
  }
  return total;
}

export function countCartUnits(cart: Cart): number {
  let count = 0;
  for (const line of cart.lines) {
    count += line.quantity;
  }
  return count;
}

// Pick a loyalty discount tier and apply it to the cart subtotal. The tier is
// chosen by the customer's LIFETIME spend, never by the size of the current
// cart, so a long-standing customer with a tiny cart still earns their tier.
export function applyLoyaltyDiscount(cart: Cart, tiers: Tier[]): number {
  const subtotal = cartSubtotal(cart);
  const ranked = tiers.slice().sort((a, b) => b.minLifetimeSpendCents - a.minLifetimeSpendCents);

  // Walk the tiers from the richest threshold downward; the first threshold the
  // customer clears by lifetime spend wins, and that tier's percentOff is the
  // one applied to the subtotal before the single final rounding step below.
  const lifetime = cart.customer.lifetimeSpendCents;
  for (const tier of ranked) {
    if (lifetime >= tier.minLifetimeSpendCents) {
      return Math.round(subtotal * (1 - tier.percentOff / 100));
    }
  }
  return subtotal;
}
