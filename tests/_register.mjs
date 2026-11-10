// Lets node's test runner resolve extensionless relative imports (lib/x -> lib/x.ts) the way Next does.
import { register } from 'node:module';
register(new URL('./_loader.mjs', import.meta.url));
