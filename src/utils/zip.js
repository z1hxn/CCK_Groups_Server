const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i;
    for (let j = 0; j < 8; j += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

const crc32 = (data) => {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    const index = (crc ^ data[i]) & 0xff;
    crc = (crc >>> 8) ^ CRC32_TABLE[index];
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const writeUInt16LE = (buffer, offset, value) => {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
};

const writeUInt32LE = (buffer, offset, value) => {
  buffer[offset] = value & 0xff;
  buffer[offset + 1] = (value >>> 8) & 0xff;
  buffer[offset + 2] = (value >>> 16) & 0xff;
  buffer[offset + 3] = (value >>> 24) & 0xff;
};

const concatUint8Arrays = (chunks) => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

const encodeDosTime = (date) => {
  const hours = date.getHours() & 0x1f;
  const minutes = date.getMinutes() & 0x3f;
  const seconds = Math.floor(date.getSeconds() / 2) & 0x1f;
  return (hours << 11) | (minutes << 5) | seconds;
};

const encodeDosDate = (date) => {
  const year = Math.max(0, date.getFullYear() - 1980) & 0x7f;
  const month = (date.getMonth() + 1) & 0x0f;
  const day = date.getDate() & 0x1f;
  return (year << 9) | (month << 5) | day;
};

export const createStoredZip = (files) => {
  const now = new Date();
  const dosTime = encodeDosTime(now);
  const dosDate = encodeDosDate(now);

  const fileEntries = files.map((file) => {
    const nameBytes = new TextEncoder().encode(String(file.name || ''));
    const dataBytes = file.data instanceof Uint8Array ? file.data : new Uint8Array(file.data || []);
    const checksum = crc32(dataBytes);
    return { nameBytes, dataBytes, checksum };
  });

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  for (const entry of fileEntries) {
    const localHeader = new Uint8Array(30 + entry.nameBytes.length);
    writeUInt32LE(localHeader, 0, 0x04034b50);
    writeUInt16LE(localHeader, 4, 20);
    writeUInt16LE(localHeader, 6, 0x0800);
    writeUInt16LE(localHeader, 8, 0);
    writeUInt16LE(localHeader, 10, dosTime);
    writeUInt16LE(localHeader, 12, dosDate);
    writeUInt32LE(localHeader, 14, entry.checksum);
    writeUInt32LE(localHeader, 18, entry.dataBytes.length);
    writeUInt32LE(localHeader, 22, entry.dataBytes.length);
    writeUInt16LE(localHeader, 26, entry.nameBytes.length);
    writeUInt16LE(localHeader, 28, 0);
    localHeader.set(entry.nameBytes, 30);

    localParts.push(localHeader, entry.dataBytes);

    const centralHeader = new Uint8Array(46 + entry.nameBytes.length);
    writeUInt32LE(centralHeader, 0, 0x02014b50);
    writeUInt16LE(centralHeader, 4, 20);
    writeUInt16LE(centralHeader, 6, 20);
    writeUInt16LE(centralHeader, 8, 0x0800);
    writeUInt16LE(centralHeader, 10, 0);
    writeUInt16LE(centralHeader, 12, dosTime);
    writeUInt16LE(centralHeader, 14, dosDate);
    writeUInt32LE(centralHeader, 16, entry.checksum);
    writeUInt32LE(centralHeader, 20, entry.dataBytes.length);
    writeUInt32LE(centralHeader, 24, entry.dataBytes.length);
    writeUInt16LE(centralHeader, 28, entry.nameBytes.length);
    writeUInt16LE(centralHeader, 30, 0);
    writeUInt16LE(centralHeader, 32, 0);
    writeUInt16LE(centralHeader, 34, 0);
    writeUInt16LE(centralHeader, 36, 0);
    writeUInt32LE(centralHeader, 38, 0);
    writeUInt32LE(centralHeader, 42, localOffset);
    centralHeader.set(entry.nameBytes, 46);
    centralParts.push(centralHeader);

    localOffset += localHeader.length + entry.dataBytes.length;
  }

  const centralDirectory = concatUint8Arrays(centralParts);
  const endOfCentralDirectory = new Uint8Array(22);
  writeUInt32LE(endOfCentralDirectory, 0, 0x06054b50);
  writeUInt16LE(endOfCentralDirectory, 4, 0);
  writeUInt16LE(endOfCentralDirectory, 6, 0);
  writeUInt16LE(endOfCentralDirectory, 8, fileEntries.length);
  writeUInt16LE(endOfCentralDirectory, 10, fileEntries.length);
  writeUInt32LE(endOfCentralDirectory, 12, centralDirectory.length);
  writeUInt32LE(endOfCentralDirectory, 16, localOffset);
  writeUInt16LE(endOfCentralDirectory, 20, 0);

  return concatUint8Arrays([...localParts, centralDirectory, endOfCentralDirectory]);
};
