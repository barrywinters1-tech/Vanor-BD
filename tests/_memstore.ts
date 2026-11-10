// Import this FIRST in a test file: it switches lib/bd-store to the in-memory backend before the store module loads.
process.env.VANOR_STORE = 'memory';
