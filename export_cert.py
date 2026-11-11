import subprocess

cmd = [
    'keytool', '-export', '-rfc',
    '-keystore', r'C:\Users\mabil\OneDrive\Desktop\dd uygulama\android-keys\deneyap-upload.jks',
    '-alias', 'deneyap',
    '-file', r'C:\Users\mabil\OneDrive\Desktop\upload_certificate.pem',
    '-storepass', 'b37L2pfZaG3tMBLNcdKBGyYDSQzPvtBF'
]

res = subprocess.run(cmd, capture_output=True, text=True)
print('STDOUT:', res.stdout)
print('STDERR:', res.stderr)
print('Exit code:', res.returncode)
