#!/usr/bin/env node
/**
 * examples/claim-token.js — E3D Token Registry claim flow, end to end
 *
 * Runnable example (and live-API test) of the "claim this token" flow
 * documented in e3d's docs/token-claim-quickstart.md — the same HTTP
 * endpoints the get_wallet_claims/claim_token tools in server.js wrap.
 * Useful for verifying the claim flow actually works against the real
 * deployed API, not just the unit tests in the e3d repo (which mock
 * ethers/ClickHouse and never make a real HTTP or RPC call).
 *
 * Two modes:
 *
 * Full-auto — needs a private key. Fine for a disposable/test wallet that
 * holds native gas + E3D/wE3D; NOT something you want to do with a real
 * project's owner wallet. Signs the entitlement challenge, and unless
 * FEE_TX_HASH is already set, also sends the fee transfer itself:
 *
 *   PRIVATE_KEY=0x... TOKEN_ADDRESS=0x... PROOF_METHOD=owner_call \
 *     node examples/claim-token.js
 *
 * Agent-safe — no private key ever touches this script. Sign the
 * entitlement challenge and pay the fee yourself (e.g. via the "Claim This
 * Token" page + MetaMask, from whichever wallet you like — the fee payer
 * doesn't have to match the proof wallet), then hand the resulting
 * sessionToken + feeTxHash here. This is what an MCP agent calling the
 * claim_token tool does:
 *
 *   SESSION_TOKEN=... WALLET=0x... FEE_TX_HASH=0x... TOKEN_ADDRESS=0x... \
 *     PROOF_METHOD=owner_call node examples/claim-token.js
 *
 * Required in both modes:
 *   TOKEN_ADDRESS   token contract address to claim
 *   PROOF_METHOD    owner_call | deployer — signature-only proof is rejected
 *                   server-side (403 PROOF_METHOD_NOT_ALLOWED)
 *
 * Full-auto mode additionally needs:
 *   PRIVATE_KEY     private key of the wallet that IS the contract's owner()/deployer
 *
 * Agent-safe mode additionally needs (SESSION_TOKEN + WALLET + FEE_TX_HASH,
 * or it falls back to full-auto; PAYMENT_METHOD below is also required here
 * since the script has no way to infer which chain you paid on):
 *   SESSION_TOKEN   bearer token from POST /api/entitlements/challenge + /verify
 *   WALLET          the wallet address that sessionToken was issued for
 *   FEE_TX_HASH     tx hash of an already-confirmed claim-fee payment (any wallet)
 *
 * Optional (both modes):
 *   CHAIN             default: ethereum
 *   PAYMENT_METHOD    default: first available payment method for the claim product
 *   WEBSITE, DESCRIPTION, CONTACT   owner-authored listing fields
 *   SOCIALS_JSON      JSON string, e.g. '{"x":"https://x.com/..."}'
 *
 * Full-auto mode only (RPC endpoints used to sign/send from PRIVATE_KEY's wallet):
 *   ETH_RPC_URL       default: https://cloudflare-eth.com
 *   BASE_RPC_URL      default: https://mainnet.base.org
 *   E3D_API_BASE_URL  default: https://e3d.ai/api
 *
 * Full-auto mode spends real E3D/wE3D + gas unless FEE_TX_HASH is already
 * set. To see current pricing without spending anything:
 *
 *   node examples/claim-token.js --check-fee
 */

import { ethers } from 'ethers';

const BASE_URL = (process.env.E3D_API_BASE_URL || 'https://e3d.ai/api').replace(/\/$/, '');

function log(msg) { console.log(`[claim-token] ${msg}`); }
function fail(msg) { console.error(`[claim-token] ERROR: ${msg}`); process.exit(1); }

async function apiRequest(method, path, { body, bearerToken } = {}) {
  const headers = { Accept: 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(BASE_URL + path, init);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

async function fetchPaymentProducts() {
  return apiRequest('GET', '/payments/products');
}

async function createChallenge({ wallet, chain }) {
  return apiRequest('POST', '/entitlements/challenge', {
    body: { wallet, chain, purpose: 'token_claim' },
  });
}

async function verifyChallenge({ challengeId, wallet, chain, message, signature }) {
  return apiRequest('POST', '/entitlements/verify', {
    body: { challengeId, wallet, chain, message, signature },
  });
}

async function payFee({ signer, method, feeAmount }) {
  const erc20 = new ethers.Contract(
    method.tokenAddress,
    ['function transfer(address,uint256) returns (bool)'],
    signer,
  );
  const amount = ethers.utils.parseUnits(String(feeAmount), 18);
  log(`Sending ${feeAmount} ${method.token} to treasury ${method.treasuryAddress} on ${method.chain}...`);
  const tx = await erc20.transfer(method.treasuryAddress, amount);
  const receipt = await tx.wait();
  const txHash = receipt.transactionHash || tx.hash;
  log(`Fee payment confirmed: ${txHash}`);
  return txHash;
}

function resolvePaymentMethod(products, paymentMethodId, preferredChain) {
  const claimProduct = (products.products || []).find((p) => p && p.product === 'claim');
  if (!claimProduct) fail('No "claim" product found in GET /payments/products response');
  const methods = claimProduct.paymentMethods || [];
  const method = paymentMethodId
    ? methods.find((m) => m.id === paymentMethodId)
    : (methods.find((m) => m.chain === preferredChain) || methods[0]);
  if (!method) fail(`Payment method ${paymentMethodId || '(default)'} not found. Available: ${methods.map((m) => m.id).join(', ')}`);
  return { claimProduct, method };
}

async function checkFee() {
  const products = await fetchPaymentProducts();
  const { claimProduct, method } = resolvePaymentMethod(products, process.env.PAYMENT_METHOD, process.env.CHAIN || 'ethereum');
  log(`Current claim fee: ${claimProduct.claimFeeE3D} ${method.token} on ${method.chain}`);
  log(`Treasury: ${method.treasuryAddress}`);
  log(`Token: ${method.tokenAddress}`);
  log(`All payment methods: ${(claimProduct.paymentMethods || []).map((m) => `${m.id} (${m.token}/${m.chain})`).join(', ')}`);
}

function buildSocials() {
  if (!process.env.SOCIALS_JSON) return undefined;
  try { return JSON.parse(process.env.SOCIALS_JSON); } catch {
    fail('SOCIALS_JSON is not valid JSON');
  }
}

async function run() {
  if (process.argv.includes('--check-fee')) {
    await checkFee();
    return;
  }

  const address = process.env.TOKEN_ADDRESS;
  const chain = process.env.CHAIN || 'ethereum';
  const proofMethod = process.env.PROOF_METHOD;
  if (!address) fail('TOKEN_ADDRESS is required');
  if (!['owner_call', 'deployer'].includes(proofMethod)) {
    fail('PROOF_METHOD must be "owner_call" or "deployer" — signature-only proof is rejected server-side');
  }

  const agentSafe = process.env.SESSION_TOKEN && process.env.WALLET && process.env.FEE_TX_HASH;

  let sessionToken;
  let wallet;
  let feeTxHash;
  let signer;
  // May get resolved to a default below if not set explicitly — captured
  // separately from process.env.PAYMENT_METHOD so the claim submission uses
  // whatever method the fee was actually paid with, not an unset env var.
  let paymentMethodId = process.env.PAYMENT_METHOD;

  if (agentSafe) {
    log('Agent-safe mode: using pre-obtained sessionToken + feeTxHash, no private key involved.');
    if (!paymentMethodId) {
      fail('PAYMENT_METHOD is required in agent-safe mode (e.g. "ethereum-e3d" or "base-we3d") — the script has no way to infer which chain FEE_TX_HASH was paid on.');
    }
    sessionToken = process.env.SESSION_TOKEN;
    wallet = ethers.utils.getAddress(process.env.WALLET);
    feeTxHash = process.env.FEE_TX_HASH;
  } else {
    if (!process.env.PRIVATE_KEY) {
      fail('Neither agent-safe mode (SESSION_TOKEN + WALLET + FEE_TX_HASH) nor PRIVATE_KEY was fully provided. See file header for usage.');
    }
    log('Full-auto mode: signing the challenge (and possibly paying the fee) with PRIVATE_KEY.');
    // Signing the challenge is off-chain and needs no provider at all — only
    // defer to a network connection once we know which chain the fee payment
    // actually needs (it may differ from `chain`, the token's own chain).
    const ownerWallet = new ethers.Wallet(process.env.PRIVATE_KEY);
    wallet = ownerWallet.address;

    log(`Requesting challenge for ${wallet}...`);
    const challenge = await createChallenge({ wallet, chain });
    const signature = await ownerWallet.signMessage(challenge.message);

    log('Verifying signed challenge...');
    const verified = await verifyChallenge({
      challengeId: challenge.challengeId,
      wallet,
      chain,
      message: challenge.message,
      signature,
    });
    sessionToken = verified.sessionToken;
    log(`Got sessionToken (expires ${verified.sessionExpiresAt}).`);

    feeTxHash = process.env.FEE_TX_HASH;
    if (!feeTxHash) {
      const products = await fetchPaymentProducts();
      const { claimProduct, method } = resolvePaymentMethod(products, process.env.PAYMENT_METHOD, chain);
      // ethers v5's getDefaultProvider() only knows a fixed set of networks
      // (mainnet, goerli, ...) and doesn't support Base — use an explicit RPC URL,
      // chosen by the payment method's own chain (which may differ from `chain`).
      const rpcUrl = method.chain === 'base'
        ? (process.env.BASE_RPC_URL || 'https://mainnet.base.org')
        : (process.env.ETH_RPC_URL || 'https://cloudflare-eth.com');
      signer = ownerWallet.connect(new ethers.providers.JsonRpcProvider(rpcUrl));
      feeTxHash = await payFee({ signer, method, feeAmount: claimProduct.claimFeeE3D });
      paymentMethodId = method.id;
    } else {
      log(`Reusing existing feeTxHash: ${feeTxHash}`);
    }
  }

  log(`Submitting claim for ${address} (proofMethod=${proofMethod})...`);
  let result;
  try {
    result = await apiRequest('POST', `/registry/tokens/${address}/claim`, {
      bearerToken: sessionToken,
      body: {
        wallet,
        chain,
        feeTxHash,
        paymentMethod: paymentMethodId,
        proofMethod,
        website: process.env.WEBSITE,
        description: process.env.DESCRIPTION,
        contact: process.env.CONTACT,
        socials: buildSocials(),
      },
    });
  } catch (err) {
    if (err.status === 403 && err.body && err.body.code === 'PROOF_MISMATCH') {
      fail(`Wallet ${wallet} does not match this contract's ${proofMethod === 'owner_call' ? 'owner()' : 'deployer'}. Use the wallet that actually controls the contract.`);
    }
    if (err.status === 409 && err.body && err.body.code === 'ALREADY_CLAIMED') {
      fail('A stronger-or-equal claim already exists for this token. owner_call outranks deployer; only a stronger proof can supersede it.');
    }
    if (err.status === 409 && err.body && err.body.code === 'FEE_TX_ALREADY_USED') {
      fail('That feeTxHash already backs a different claim. Pay again with a fresh transaction.');
    }
    throw err;
  }

  log(`Claimed. proofMethod=${result.proofMethod}, apiKey=${result.apiKey}`);
  log('Store that apiKey now — it is shown exactly once and there is no recovery.');

  log('Verifying via GET /tokens/:address/metadata...');
  const metadata = await apiRequest('GET', `/tokens/${address}/metadata`);
  log(`claim.claimed=${metadata.claim && metadata.claim.claimed}, claim.proofMethod=${metadata.claim && metadata.claim.proofMethod}`);
}

run().catch((err) => fail(err.message || String(err)));
