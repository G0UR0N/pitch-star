"""Fresh QR code for the game with a cache-busting tag.
Usage: make_qr.py <output.png>   (tag = current time)"""
import sys
import time

import qrcode

url = f"https://g0ur0n.github.io/pitch-star/app/?v={time.strftime('%Y%m%d-%H%M')}"
qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=14, border=4)
qr.add_data(url)
qr.make(fit=True)
qr.make_image(fill_color="#1b1035", back_color="white").save(sys.argv[1])
print(url)
