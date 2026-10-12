#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mqtt-pub.py — Tek seferlik MQTT yayını (üçüncü parti kütüphane YOK).

Kullanım:
  python mqtt-pub.py <host> <port> <topic> <payload>
  python mqtt-pub.py <host> <port> <topic> <device> <action> [value]
Örnek:
  python mqtt-pub.py broker.hivemq.com 1883 deneyap/kart1/cmd gas recalibrate
  python mqtt-pub.py broker.emqx.io    1883 deneyap/kart1/cmd fan on
  python mqtt-pub.py broker.emqx.io    1883 deneyap/kart1/cmd "{\"id\":1,\"device\":\"fan\",\"action\":\"on\"}"

İkinci biçim, kabuk (PowerShell) tırnak soymasını önlemek için JSON'u kendisi
kurar ve artan bir `id` üretir. Üçüncü biçim ham JSON gövdesini olduğu gibi yollar.

Panelin cihaza komut göndermesiyle aynı yolu (QoS0 PUBLISH) taklit eder.
CONNECT -> CONNACK bekle -> PUBLISH -> DISCONNECT.
"""
import json
import socket
import struct
import sys
import time


def encode_len(n):
    out = bytearray()
    while True:
        b = n % 128
        n //= 128
        if n > 0:
            b |= 0x80
        out.append(b)
        if n == 0:
            break
    return bytes(out)


def read_packet(sock):
    head = sock.recv(1)
    if not head:
        return None
    mult = 1
    length = 0
    while True:
        b = sock.recv(1)
        if not b:
            return None
        length += (b[0] & 0x7F) * mult
        if not (b[0] & 0x80):
            break
        mult *= 128
    body = b""
    while len(body) < length:
        chunk = sock.recv(length - len(body))
        if not chunk:
            break
        body += chunk
    return head[0], body


def main():
    if len(sys.argv) < 5:
        print(__doc__)
        sys.exit(2)
    host, port, topic = sys.argv[1], int(sys.argv[2]), sys.argv[3]

    if len(sys.argv) == 5:
        # Ham JSON gövdesi (tırnaklar kabuktan korunmuş olmalı)
        payload = sys.argv[4]
    else:
        # device action [value] -> JSON (kabuk tırnak sorununu önler)
        device = sys.argv[4]
        action = sys.argv[5]
        cmd = {
            "id": int(time.time()) % 100000,
            "device": device,
            "action": action,
        }
        if len(sys.argv) > 6:
            raw = sys.argv[6]
            try:
                cmd["value"] = int(raw)
            except ValueError:
                cmd["value"] = raw
        payload = json.dumps(cmd, ensure_ascii=False)

    client_id = ("pub-%d" % time.time()).encode()
    var = b"\x00\x04MQTT\x04\x02\x00\x3c"
    pl = struct.pack(">H", len(client_id)) + client_id
    body = var + pl
    connect = b"\x10" + encode_len(len(body)) + body

    sock = socket.create_connection((host, port), timeout=8)
    sock.settimeout(8)
    sock.sendall(connect)
    pkt = read_packet(sock)
    if not pkt or pkt[0] != 0x20 or len(pkt[1]) < 2 or pkt[1][1] != 0:
        print("CONNECT basarisiz:", pkt)
        sock.close()
        sys.exit(1)
    print("CONNACK accept")

    tb = topic.encode()
    pb = payload.encode()
    vh = struct.pack(">H", len(tb)) + tb + pb
    publish = b"\x30" + encode_len(len(vh)) + vh
    sock.sendall(publish)
    print("PUBLISH -> %s : %s" % (topic, payload))

    # nazik kapanış
    try:
        sock.sendall(b"\xe0\x00")
    except OSError:
        pass
    sock.close()


if __name__ == "__main__":
    main()
