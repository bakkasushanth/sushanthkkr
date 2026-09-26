import zlib
import struct

def make_png(width, height):
    png = b'\x89PNG\r\n\x1a\n'
    ihdr_data = struct.pack("!IIBBBBB", width, height, 8, 6, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data)
    png += struct.pack("!I", len(ihdr_data)) + b'IHDR' + ihdr_data + struct.pack("!I", ihdr_crc)
    raw_data = b'\x00' + b'\x00\x00\x00\x00' * width
    raw_data = raw_data * height
    idat_data = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + idat_data)
    png += struct.pack("!I", len(idat_data)) + b'IDAT' + idat_data + struct.pack("!I", idat_crc)
    iend_data = b''
    iend_crc = zlib.crc32(b'IEND' + iend_data)
    png += struct.pack("!I", len(iend_data)) + b'IEND' + iend_data + struct.pack("!I", iend_crc)
    with open("build/icon.png", "wb") as f:
        f.write(png)

make_png(512, 512)
