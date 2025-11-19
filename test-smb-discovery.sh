#!/bin/bash
# Test script for SMB discovery
# Tests the same logic that the app uses

set -e

echo "======================================"
echo "SMB Discovery Test"
echo "======================================"
echo ""

# Get subnet
if [ -z "$1" ]; then
    echo "Usage: $0 <subnet> [username] [password]"
    echo "Example: $0 10.147.14"
    echo "Example with auth: $0 10.147.14 admin mypassword"
    exit 1
fi

SUBNET="$1"
USERNAME="${2:-}"
PASSWORD="${3:-}"

echo "Testing subnet: ${SUBNET}.0/24"
if [ -n "$USERNAME" ]; then
    echo "Using authentication: $USERNAME"
else
    echo "Using guest access (no auth)"
fi
echo ""

# Step 1: TCP 445 Scan
echo "Step 1: Scanning for SMB servers (TCP port 445)..."
echo "--------------------------------------------"

SMB_HOSTS=()
for i in {1..254}; do
    IP="${SUBNET}.${i}"
    # Try to connect to port 445 with timeout
    if timeout 1 bash -c "echo >/dev/tcp/$IP/445" 2>/dev/null; then
        echo "✓ Found SMB server: $IP"
        SMB_HOSTS+=("$IP")
    fi
done

echo ""
echo "Found ${#SMB_HOSTS[@]} SMB server(s)"
echo ""

if [ ${#SMB_HOSTS[@]} -eq 0 ]; then
    echo "No SMB servers found on subnet ${SUBNET}.0/24"
    echo ""
    echo "Possible reasons:"
    echo "  - No hosts have SMB/CIFS enabled"
    echo "  - Firewall blocking TCP port 445"
    echo "  - Wrong subnet"
    exit 0
fi

# Step 2: Discover shares on each host
echo "Step 2: Discovering shares on each host..."
echo "--------------------------------------------"

TOTAL_SHARES=0

for HOST in "${SMB_HOSTS[@]}"; do
    echo ""
    echo "Host: $HOST"
    echo "  Querying shares..."

    # Build smbclient command
    CMD="smbclient -L $HOST"
    if [ -n "$USERNAME" ] && [ -n "$PASSWORD" ]; then
        CMD="$CMD -U '$USERNAME%$PASSWORD'"
    else
        CMD="$CMD -N"
    fi
    CMD="$CMD -g"

    # Execute and parse
    SHARES=$(eval $CMD 2>/dev/null | grep "^Disk|" || true)

    if [ -z "$SHARES" ]; then
        echo "  No shares found (or access denied)"
        continue
    fi

    # Parse and display shares
    COUNT=0
    while IFS='|' read -r type name comment; do
        if [ "$type" = "Disk" ]; then
            # Skip admin shares
            if [[ "$name" == *$ ]]; then
                echo "  [ADMIN] $name (skipped)"
                continue
            fi

            ((COUNT++))
            ((TOTAL_SHARES++))

            if [ -n "$comment" ]; then
                echo "  ✓ $name - $comment"
            else
                echo "  ✓ $name"
            fi
        fi
    done <<< "$SHARES"

    echo "  Total: $COUNT share(s)"
done

echo ""
echo "======================================"
echo "Summary:"
echo "  SMB Servers: ${#SMB_HOSTS[@]}"
echo "  Total Shares: $TOTAL_SHARES"
echo "======================================"
