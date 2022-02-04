let cp = require("child_process");
let os = require("os");

let shell = os.type() === 'Windows_NT' ? "c:\\Program Files\\Git\\bin\\bash.exe" : true;

let cmdline = process.argv.slice(2).map(s => '"' + s.replace(/([\\"])/g, '\\$1') + '"').join(' ');

let result = cp.spawnSync(cmdline, { stdio: 'inherit', shell: shell });

process.exit(result.status != null ? result.status : 1);
