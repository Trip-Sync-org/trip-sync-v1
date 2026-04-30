import base64

with open('server_b64.txt', 'r') as f:
    b64 = f.read().strip()

# Split into chunks of 400 chars each (very safe for terminal paste)
CHUNK = 400
chunks = [b64[i:i+CHUNK] for i in range(0, len(b64), CHUNK)]

print(f"Total chunks: {len(chunks)}, total b64 len: {len(b64)}")

with open('server_fix_cmds.txt', 'w') as out:
    out.write("# === PASTE THESE COMMANDS ONE BY ONE ON YOUR SERVER ===\n\n")
    
    # First command: initialize the file (empty)
    out.write("# CMD 0: Clear the output file\n")
    out.write("rm -f /tmp/server_new.js\n\n")
    
    # Each chunk: append decoded bytes to file
    for i, chunk in enumerate(chunks):
        out.write(f"# CMD {i+1} of {len(chunks)}:\n")
        out.write(f'python3 -c "import base64; open(\'/tmp/server_new.js\',\'ab\').write(base64.b64decode(\'{chunk}\'))"\n\n')
    
    # Final: move to destination and restart
    out.write(f"# CMD {len(chunks)+1}: Verify size and deploy\n")
    out.write('wc -c /tmp/server_new.js\n\n')
    
    out.write(f"# CMD {len(chunks)+2}: Copy to server location\n")
    out.write('cp /tmp/server_new.js /var/www/tripsync-socket/server.js\n\n')
    
    out.write(f"# CMD {len(chunks)+3}: Check syntax\n")
    out.write('node --check /var/www/tripsync-socket/server.js && echo "SYNTAX OK"\n\n')
    
    out.write(f"# CMD {len(chunks)+4}: Restart and test\n")
    out.write('pm2 restart tripsync-socket && sleep 3 && curl http://localhost:4000/health\n')

print(f"Written server_fix_cmds.txt with {len(chunks)+5} commands")
print(f"Each chunk is {CHUNK} chars of base64 = very safe to paste")
