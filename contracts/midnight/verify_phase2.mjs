import fetch from 'node-fetch';

const BASE = 'http://localhost:3000';
const routes = [
  '/',
  '/pool',
  '/privacy',
  '/architecture',
  '/setup',
  '/health'
];

console.log('=== PHASE 2: FRONTEND CONNECTION & ROUTE AUDIT ===\n');

let allPassed = true;

for (const route of routes) {
  const url = `${BASE}${route}`;
  try {
    const res = await fetch(url);
    const status = res.status;
    const body = await res.text();
    
    const hasPreprod = /preprod/i.test(body);
    const hasError = /Application error|Internal Server Error|Unhandled Runtime Error|Crash/i.test(body);
    const hasPreview = /preview/i.test(body);
    
    const pass = status === 200 && !hasPreprod && !hasError;
    if (!pass) allPassed = false;
    
    console.log(`Route [${route.padEnd(14)}] -> Status: ${status} | Preprod Leak: ${hasPreprod} | Errors: ${hasError} | Has Preview: ${hasPreview} | Result: ${pass ? 'PASS' : 'FAIL'}`);
    if (hasPreprod) {
      console.log(`   [WARN] Found 'preprod' in route ${route}`);
    }
  } catch (err) {
    allPassed = false;
    console.log(`Route [${route.padEnd(14)}] -> Fetch Failed: ${err.message}`);
  }
}

console.log(`\n=== PHASE 2 SUMMARY ===`);
console.log(`Frontend routes audit: ${allPassed ? 'PASS' : 'FAIL'}`);
