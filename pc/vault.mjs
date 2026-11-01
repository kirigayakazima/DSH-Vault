// Stable CLI facade; implementation lives in explicit control-layer modules.
import {runVaultCli} from './control/commands.mjs';
await runVaultCli(process.argv.slice(2));
