const fs = require('fs').promises;
const path = require('path');

const CHUNK_MIN = {
    mp4: 8,
    mov: 8,
    wmv: 24
};

const MAX_EXTRA_BYTES = 1000;

async function getFileType(filePath) {
    const fd = await fs.open(filePath, 'r');
    const buffer = Buffer.alloc(16);
    await fd.read(buffer, 0, 16, 0);
    await fd.close();

    if (buffer.toString('ascii', 4, 8) === 'ftyp') {
        const brand = buffer.toString('ascii', 8, 12);
        if (['isom', 'iso2', 'mp41', 'mp42', 'M4V '].includes(brand)) {
            return 'mp4';
        } else if (brand === 'qt  ') {
            return 'mov';
        }
    } else if (buffer.slice(0, 4).equals(Buffer.from([0x30, 0x26, 0xB2, 0x75]))) {
        return 'wmv';
    }

    throw new Error('Unsupported file type');
}

async function decodeChunkTypeLength(fileType, fd, pos, chunkData) {
    let chunkLength, chunkType;

    if (fileType === 'wmv') {
        chunkType = chunkData.slice(0, 16).toString('hex');
        chunkLength = chunkData.readBigUInt64LE(16);
    } else { // mp4 or mov
        chunkLength = chunkData.readUInt32BE(0);
        chunkType = chunkData.toString('ascii', 4, 8);
        
        if (chunkLength === 1) {
            const chunk64size = Buffer.alloc(8);
            await fd.read(chunk64size, 0, 8, pos + 8);
            chunkLength = chunk64size.readBigUInt64BE(0);
        }
    }

    return { chunkType, chunkLength: Number(chunkLength) };
}

async function findExtraBytes(filePath) {
    const fileType = await getFileType(filePath);
    const chunkMin = CHUNK_MIN[fileType];
    const fileSize = (await fs.stat(filePath)).size;

    const result = {
        fileType,
        fileSize,
        extraBytes: 0,
        isClean: true,
        falsePositive: false,
        chunks: []
    };

    const fd = await fs.open(filePath, 'r');
    let pos = 0;

    while (pos < fileSize) {
        const remainingBytes = fileSize - pos;

        if (remainingBytes < chunkMin) {
            result.extraBytes = remainingBytes;
            result.isClean = false;
            break;
        }

        const chunkData = Buffer.alloc(chunkMin);
        await fd.read(chunkData, 0, chunkMin, pos);

        const { chunkType, chunkLength } = await decodeChunkTypeLength(fileType, fd, pos, chunkData);

        result.chunks.push({ offset: pos, length: chunkLength, type: chunkType });

        if (chunkLength < chunkMin || chunkLength > remainingBytes) {
            if (remainingBytes > MAX_EXTRA_BYTES) {
                result.falsePositive = true;
                break;
            } else {
                result.extraBytes = remainingBytes;
                result.isClean = false;
                break;
            }
        }

        if (chunkLength === 0) break;

        pos += chunkLength;
    }

    await fd.close();
    return result;
}

async function removeExtraBytes(filePath, backupData = true) {
    const result = await findExtraBytes(filePath);

    if (result.extraBytes > 0 && !result.falsePositive) {
        const newSize = result.fileSize - result.extraBytes;

        if (backupData) {
            // Backup extra bytes
            const extraBuffer = Buffer.alloc(result.extraBytes);
            const fdRead = await fs.open(filePath, 'r');
            await fdRead.read(extraBuffer, 0, result.extraBytes, newSize);
            await fdRead.close();

            const backupPath = `${filePath}.txt`;
            await fs.writeFile(backupPath, extraBuffer);
            result.backupPath = backupPath;
        }

        // Truncate the file
        await fs.truncate(filePath, newSize);
        
        result.cleaned = true;
    } else {
        result.cleaned = false;
    }

    return result;
}

module.exports = {
    findExtraBytes,
    removeExtraBytes
};