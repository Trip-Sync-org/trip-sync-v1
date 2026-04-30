import base64

with open('server_b64.txt', 'r') as f:
    b64 = f.read().strip()

third = len(b64) // 3
p1 = b64[:third]
p2 = b64[third:third*2]
p3 = b64[third*2:]

with open('server_cmds.txt', 'w') as out:
    out.write("# === PASTE THESE 5 COMMANDS ONE BY ONE INTO YOUR SERVER SSH TERMINAL ===\n\n")
    out.write("# CMD 1 of 5:\n")
    out.write('node -e "process.stdout.write(Buffer.from(\'' + p1 + '\',\'base64\'))" > /tmp/sv1.bin\n\n')
    out.write("# CMD 2 of 5:\n")
    out.write('node -e "process.stdout.write(Buffer.from(\'' + p2 + '\',\'base64\'))" > /tmp/sv2.bin\n\n')
    out.write("# CMD 3 of 5:\n")
    out.write('node -e "process.stdout.write(Buffer.from(\'' + p3 + '\',\'base64\'))" > /tmp/sv3.bin\n\n')
    out.write("# CMD 4 of 5:\n")
    out.write('cat /tmp/sv1.bin /tmp/sv2.bin /tmp/sv3.bin > /var/www/tripsync-socket/server.js && echo "Written OK" && wc -c /var/www/tripsync-socket/server.js\n\n')
    out.write("# CMD 5 of 5:\n")
    out.write('pm2 restart tripsync-socket && sleep 2 && curl http://localhost:4000/health\n')

print("Done! server_cmds.txt written.")
print("Part lengths:", len(p1), len(p2), len(p3))
