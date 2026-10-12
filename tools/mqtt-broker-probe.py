#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
mqtt-broker-probe.py — MQTT broker erişim teşhisi (üçüncü parti kütüphane YOK).

Amaç: Kartın `deneyap/kart1` konusuyla bağlandığı herkese açık broker'lara
(ve aynı broker'ın DNS'teki tüm A kayıtlarına) gerçek bir MQTT CONNECT atıp
CONNACK alınıp alınmadığını ölçmek. Böylece "MQTT niye koptu" sorusunu
ağ/port/DNS/broker sağlığı katmanlarına ayırabiliriz.

Kullanım:
  python mqtt-broker-probe.py                      # varsayılan hedef listesi
  python mqtt-broker-probe.py --host broker.emqx.io --port 1883
  python mqtt-broker-probe.py --watch --interval 120 --log probe.log

Çıkış kodu (CONNACK): 0=accept, 1=protokol, 2=clientId, 3=sunucu dolu,
4=kullanıcı/şifre, 5=yetki. Zaman aşımı veya TCP hatası "ERR/no-conn" gösterir.
"""
import argparse
import socket
import struct
import sys
import time

DEFAULT_TARGETS = [
    # (isim, host, port)
    ("emqx(dns)", "broker.emqx.io", 1883),
    ("emqx#1", "34.243.217.54", 1883),
    ("emqx#2", "35.172.255.228", 1883),
    ("emqx#3", "44.232.241.40", 1883),
    ("emqx-wss", "broker.emqx.io", 8084),
    ("hivemq", "broker.hivemq.com", 1883),
    ("mosquitto", "test.mosquitto.org", 1883),
]


def mqtt_connect_check(host, port, timeout=8.0):
    """Ham MQTT CONNECT gönder, CONNACK oku. (connack_kodu, rtt_ms) veya (None, None)."""
    client_id = ("probe-%d" % time.time()).encode("ascii")
    var_header = b"\x00\x04MQTT\x04\x02\x00\x3c"          # proto MQTT, level 4, clean, keepalive 60
    payload = struct.pack(">H", len(client_id)) + client_id
    body = var_header + payload
    rem = len(body)
    if rem < 128:
        fixed = b"\x10" + bytes([rem])
    else:
        # tek bayt yetersiz -> genel amaçlı kodlama (probe için kısa)
        enc = bytearray()
        while rem > 0:
            b = rem % 128
            rem //= 128
            if rem > 0:
                b |= 0x80
            enc.append(b)
        fixed = b"\x10" + bytes(enc)
    pkt = fixed + body

    try:
        sock = socket.create_connection((host, port), timeout=timeout)
    except OSError as e:
        return None, None, "TCP HATA: %s" % str(e)
    t0 = time.time()
    try:
        sock.settimeout(timeout)
        sock.sendall(pkt)
        head = sock.recv(4)
        if len(head) < 2 or head[0] != 0x20:
            return None, None, "beklenmeyen yanit: %r" % head
        # CONNACK sabit başlığı: 0x20 0x02 (len) + 2 bayt
        extra = b""
        while len(head) + len(extra) < 4:
            chunk = sock.recv(4)
            if not chunk:
                break
            extra += chunk
        if len(head) + len(extra) < 4:
            return None, None, "CONNACK kısa: %r" % (head + extra)
        full = (head + extra)[:4]
        return full[3], (time.time() - t0) * 1000.0, "ok"
    except socket.timeout:
        return None, None, "zaman asimi (%ss)" % timeout
    except OSError as e:
        return None, None, "IO HATA: %s" % str(e)
    finally:
        try:
            sock.close()
        except Exception:
            pass


def fmt(connack):
    if connack is None:
        return "ERR "
    codes = {0: "ACCEPT", 1: "PROT ", 2: "CLIENT", 3: "DOLU ", 4: "USER ", 5: "YETKI"}
    return codes.get(connack, "r%d" % connack)


def main():
    ap = argparse.ArgumentParser(description="MQTT broker erişim teşhisi")
    ap.add_argument("--host", help="tek hedef host")
    ap.add_argument("--port", type=int, default=1883)
    ap.add_argument("--timeout", type=float, default=8.0)
    ap.add_argument("--watch", action="store_true", help="sürekli ölçüm")
    ap.add_argument("--interval", type=int, default=60, help="watch aralığı (sn)")
    ap.add_argument("--log", help="watch çıktısını bu dosyaya da yaz")
    args = ap.parse_args()

    if args.host:
        targets = [("hedef", args.host, args.port)]
    else:
        targets = DEFAULT_TARGETS

    def log(msg):
        line = "%s  %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
        print(line, flush=True)
        if args.log:
            with open(args.log, "a", encoding="utf-8") as f:
                f.write(line + "\n")

    while True:
        for name, host, port in targets:
            code, rtt, note = mqtt_connect_check(host, port, args.timeout)
            if code is None:
                log("[%-10s] %-40s %-16s  ~ %s" % (name, host, "ERROR", note))
            else:
                log("[%-10s] %-40s %-16s  rtt=%6.1f ms" % (name, host, fmt(code), rtt or 0))
        if not args.watch:
            break
        log("---- %d sn sonra tekrar ----" % args.interval)
        time.sleep(args.interval)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)