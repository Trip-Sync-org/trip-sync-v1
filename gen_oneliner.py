import base64

with open('server_b64.txt', 'r') as f:
    b64 = f.read().strip()

# Split b64 into 3 parts for concatenation inside Python
third = len(b64) // 3
p1 = b64[:third]
p2 = b64[third:third*2]
p3 = b64[third*2:]

# Generate a single python3 command that concatenates 3 parts
# Each part is ~7700 chars - still too long for terminal
# Instead, write a Python script file using printf, then run it

# Generate the script content
script = f"""import base64
p1='{p1}'
p2='{p2}'
p3='{p3}'
data=base64.b64decode(p1+p2+p3)
open('/var/www/tripsync-socket/server.js','wb').write(data)
print('Written',len(data),'bytes')
"""

# Write the script to a file that can be transferred
with open('fix_server.py', 'w') as f:
    f.write(script)

print("fix_server.py written")
print(f"Script size: {len(script)} bytes")
print(f"Part lengths: {len(p1)}, {len(p2)}, {len(p3)}")

# Also generate the scp command
print()
print("=== SCP COMMAND (run in PowerShell with passphrase) ===")
print('scp -i "C:\\Users\\DELL\\.ssh\\TripSync" fix_server.py root@165.232.179.143:/tmp/fix_server.py')
print()
print("=== THEN ON SERVER ===")
print("python3 /tmp/fix_server.py")
print("node --check /var/www/tripsync-socket/server.js && echo SYNTAX_OK")
print("pm2 restart tripsync-socket && sleep 3 && curl http://localhost:4000/health")
