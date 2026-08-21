/**
 * Minimal store-only (uncompressed) ZIP writer.
 *
 * The payload is JPEG screenshots plus a little markdown, so deflating buys
 * almost nothing — the original userscript already passed `level: 0` to
 * fflate. Writing the container by hand drops the last third-party
 * dependency, which keeps the extension free of bundled remote code.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i++) {
    let value = i;

    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[i] = value >>> 0;
  }

  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;

  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP stores timestamps in MS-DOS format, which starts at 1980. */
function toDosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());

  return {
    time:
      (date.getHours() << 11) |
      (date.getMinutes() << 5) |
      (Math.floor(date.getSeconds() / 2) & 0x1f),
    date:
      ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function textToBytes(value) {
  return new TextEncoder().encode(String(value));
}

/**
 * @param {Array<{ path: string, data: Uint8Array }>} entries
 * @param {Date} [now] timestamp stamped into every entry
 * @returns {Blob}
 */
export function createZip(entries, now = new Date()) {
  const { time, date } = toDosDateTime(now);
  const chunks = [];
  const central = [];

  let offset = 0;

  for (const entry of entries) {
    const nameBytes = textToBytes(entry.path);
    const data = entry.data;
    const checksum = crc32(data);

    const local = new DataView(new ArrayBuffer(30));

    local.setUint32(0, 0x04034b50, true); // local file header signature
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0x0800, true); // UTF-8 filename flag
    local.setUint16(8, 0, true); // compression: store
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, checksum, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra field length

    chunks.push(new Uint8Array(local.buffer), nameBytes, data);

    const dir = new DataView(new ArrayBuffer(46));

    dir.setUint32(0, 0x02014b50, true); // central directory signature
    dir.setUint16(4, 20, true); // version made by
    dir.setUint16(6, 20, true); // version needed
    dir.setUint16(8, 0x0800, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, date, true);
    dir.setUint32(16, checksum, true);
    dir.setUint32(20, data.length, true);
    dir.setUint32(24, data.length, true);
    dir.setUint16(28, nameBytes.length, true);
    dir.setUint16(30, 0, true); // extra
    dir.setUint16(32, 0, true); // comment
    dir.setUint16(34, 0, true); // disk number start
    dir.setUint16(36, 0, true); // internal attributes
    dir.setUint32(38, 0, true); // external attributes
    dir.setUint32(42, offset, true); // relative offset of local header

    central.push(new Uint8Array(dir.buffer), nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((total, part) => total + part.length, 0);

  const end = new DataView(new ArrayBuffer(22));

  end.setUint32(0, 0x06054b50, true); // end of central directory signature
  end.setUint16(4, 0, true); // this disk
  end.setUint16(6, 0, true); // disk with central directory
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  end.setUint16(20, 0, true); // comment length

  return new Blob([...chunks, ...central, new Uint8Array(end.buffer)], {
    type: 'application/zip',
  });
}
