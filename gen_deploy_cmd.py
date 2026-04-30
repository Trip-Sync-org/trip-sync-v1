import base64

with open('server_b64.txt', 'r') as f:
    b64 = f.read().strip()

print("cd /var/www/tripsync-socket")
print()
print("python3 << 'PYEOF'")
print("import base64")
print("b64 = '" + b64 + "'")
print("open('server.js', 'wb').write(base64.b64decode(b64))")
print("print('server.js written, size:', len(base64.b64decode(b64)), 'bytes')")
print("PYEOF")
print()
print("pm2 restart tripsync-socket && sleep 2 && curl http://localhost:4000/health")
