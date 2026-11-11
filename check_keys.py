import os
import subprocess

paths = [
    r'C:\Users\mabil\AppData\Local\dd-android\deneyap-upload.jks',
    r'C:\Users\mabil\OneDrive\Desktop\dd uygulama\android-keys\deneyap-upload.jks',
    r'C:\Users\mabil\mylifevilla-repo\keystore'
]

passwords = ['b37L2pfZaG3tMBLNcdKBGyYDSQzPvtBF', 'android', 'password', '123456']

for p in paths:
    if os.path.exists(p):
        print('Checking:', p)
        for pw in passwords:
            cmd = f'keytool -list -v -keystore "{p}" -storepass {pw}'
            res = subprocess.run(cmd, capture_output=True, text=True, shell=True)
            if 'SHA1:' in res.stdout:
                print(f'  Success with pass {pw}:')
                print(res.stdout)
                if '73:2D:E7:C0' in res.stdout:
                    print('*** FOUND MATCHING KEYSTORE: ***', p)
