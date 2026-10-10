# Commercial Store + Wallet Starter

This starter keeps the frontend static for GitHub Pages and uses Supabase for authentication, data and server-side functions, with Paystack for deposits.

**This is a starter scaffold, not a production-ready store.** Wallet deposit crediting is designed around server verification and an idempotent database function, but you must configure, test and review it before accepting real funds. Wallet checkout intentionally remains disabled until its atomic database function is implemented.

## Files
- `index.html`, `styles.css`, `app.js`: static frontend
- `supabase/schema.sql`: initial database schema and RLS policies
- `supabase/functions/create-deposit/index.ts`: authenticated deposit initialization
- `supabase/functions/paystack-webhook/index.ts`: signed webhook plus Paystack verification
- `supabase/functions/place-wallet-order/index.ts`: deliberately disabled checkout placeholder

## 1. Deploy the frontend
1. Upload the contents of this folder to your commercial site's GitHub repository.
2. In `app.js`, set `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` using the Supabase project's public browser values.
3. In GitHub, open Settings → Pages and publish the correct branch/folder.
4. In Supabase Auth URL settings, add your GitHub Pages URL to the allowed redirect URLs.
5. Replace the demo product cards with your real product catalogue after the backend is ready.

Only the Supabase publishable/anon key belongs in the browser. Never put a Paystack secret or Supabase service-role/secret key in this repository.

## 2. Create the Supabase database
1. Create a new Supabase project.
2. Open SQL Editor and run `supabase/schema.sql`.
3. Review the RLS policies and test access with separate customer accounts.
4. Add products to `public.products` using the SQL editor or a protected admin process. Do not let ordinary customers set prices or stock.

## 3. Add backend secrets
Install the Supabase CLI and link your project. Set these Edge Function secrets:
- `PAYSTACK_SECRET_KEY` — Paystack test secret during development
- `SUPABASE_SERVICE_ROLE_KEY` — service role key; server only
- `FRONTEND_RETURN_URL` — exact HTTPS URL customers should return to, e.g. `https://YOUR-USERNAME.github.io/YOUR-REPO/`

Supabase provides `SUPABASE_URL` and project keys in its Edge Function environment in standard deployments. If your environment does not provide `SUPABASE_ANON_KEY`, set it as a function secret too.

## 4. Required missing SQL function for safe deposits
Before deploying the webhook, create the following function in Supabase SQL Editor. It locks the pending payment attempt and wallet, checks exact amount/currency, and credits the wallet once.

```sql
create or replace function public.credit_verified_deposit(
  p_reference text,
  p_amount_kobo bigint,
  p_currency text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  attempt public.payment_attempts%rowtype;
begin
  if p_currency <> 'NGN' or p_amount_kobo <= 0 then
    raise exception 'Invalid payment amount or currency';
  end if;

  select * into attempt
  from public.payment_attempts
  where provider_reference = p_reference
  for update;

  if not found then raise exception 'Unknown payment reference'; end if;

  if attempt.amount_kobo <> p_amount_kobo or attempt.currency <> p_currency then
    raise exception 'Payment amount mismatch';
  end if;

  if attempt.status = 'successful' then
    return; -- idempotent: duplicate webhook does not credit twice
  end if;

  if attempt.status <> 'pending' then
    raise exception 'Payment is not pending';
  end if;

  update public.wallets
  set balance_kobo = balance_kobo + p_amount_kobo, updated_at = now()
  where user_id = attempt.user_id;

  if not found then raise exception 'Wallet not found'; end if;

  insert into public.wallet_transactions(
    user_id, kind, amount_kobo, status, provider, provider_reference, description
  ) values (
    attempt.user_id, 'deposit', p_amount_kobo, 'successful', 'paystack',
    p_reference, 'Verified wallet deposit'
  );

  update public.payment_attempts
  set status = 'successful', verified_at = now()
  where id = attempt.id;
end;
$$;

revoke all on function public.credit_verified_deposit(text,bigint,text) from public, anon, authenticated;
grant execute on function public.credit_verified_deposit(text,bigint,text) to service_role;
```

Run this only after reviewing it in your own project. In a production system, add reconciliation, audit logging, limits, monitoring and appropriate refund/reversal handling.

## 5. Deploy functions
After installing the Supabase CLI and linking the project:

```bash
supabase functions deploy create-deposit
supabase functions deploy paystack-webhook --no-verify-jwt
supabase functions deploy place-wallet-order
```

Configure Paystack's webhook URL to the deployed `paystack-webhook` function URL. Paystack signs webhook requests; the function checks the signature and verifies the transaction with Paystack before calling the database function.

Restrict CORS in `create-deposit` to your exact website origin before launch. Test in Paystack test mode first.

## 6. Important production work still required
- Implement `place_wallet_order` as a database transaction that validates product IDs, quantities, current prices, stock and balance, then deducts funds and creates order/line items atomically. Do not enable the checkout endpoint until done.
- Add rate limits and deposit/withdrawal controls as appropriate.
- Test duplicate webhooks, wrong amount/currency, invalid signatures, concurrent purchases and insufficient balance.
- Keep a complete ledger and reconcile Paystack settlement records.
- Consult Nigerian legal/compliance advice before holding customer funds in an internal wallet; requirements may apply to stored value and payment services.
