import fs from "fs";

const solfile = process.argv[2];
const docfile = process.argv[3];
const outfile = process.argv[4];
const docpart = process.env.EVENTS === 'true' ? 'events' : 'methods';

const soltext = fs.readFileSync(solfile).toString();
const docjson = JSON.parse(fs.readFileSync(docfile).toString());

const order: Record<string, number> = {};
let count = 0;
for (const match of soltext.matchAll(/\n\s*(function|event)\s+(\w+)/g)) {
    order[match[2]] = count++;
}

const methods: Record<string, any> = docjson[docpart];

const lines: [string, number][] = [];

for (const [signature, doc] of Object.entries(methods)) {
    const func = signature.slice(0, signature.indexOf('('));
    lines.push([`**${func}** - ${doc.notice}`, order[func]]);
}

lines.sort((a, b) => a[1] - b[1]);

fs.writeFileSync(outfile, lines.map(l => l[0]).join('\n\n'));
