import baseX from 'base-x'
import crypto from 'crypto';

const BASE58_CHARS = 'rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz'
const ALL_CHARS = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
const codec = baseX(BASE58_CHARS)

function sha256(data: string) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

function sha256Checksum(payload: string) {
    return sha256(sha256(payload)).substr(0, 8);
}

export function randomXrpAddress() {
    const randomBytes = crypto.randomBytes(20).toString('hex');
    const accountID = "00" + randomBytes;
    const checksum = sha256Checksum(accountID);
    return codec.encode(Buffer.from(accountID + checksum, 'hex'));
}

export function randomBase58Address() {
    return codec.encode(crypto.randomBytes(25));
}

export function randomAddress() {
    // generates a random string of length between 25 and 35
    const length = Math.floor(Math.random() * 10) + 25;
    let address = '';
    for (let i = 0; i < length; i++) {
        const char = ALL_CHARS[Math.floor(Math.random() * ALL_CHARS.length)];
        address += char;
    }
    return address;
}
