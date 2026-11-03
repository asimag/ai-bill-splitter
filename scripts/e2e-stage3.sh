#!/usr/bin/env bash
# Stage 3 live smoke test against the dev API using the REAL local vision model.
set -euo pipefail
BASE=http://127.0.0.1:8787/api
JAR=/tmp/billsplit-stage3.cookies
EMAIL="stage3-live-$(date +%s)@test.local"
PNG="${1:-/private/var/folders/k6/f0xqgss96rzfh744n23hs_700000gn/T/opencode/receipt.png}"
rm -f "$JAR"

echo "== register"
curl -s -c "$JAR" -H 'content-type: application/json' -d "{\"email\":\"$EMAIL\",\"password\":\"password123\"}" "$BASE/auth/register" | head -c 200; echo

echo "== create trip (USD)"
TRIP=$(curl -s -b "$JAR" -H 'content-type: application/json' -d '{"name":"Live scan trip","currency":"USD"}' "$BASE/trips" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["trip"]["id"]')
echo "trip=$TRIP"

echo "== participants"
ALI=$(curl -s -b "$JAR" -H 'content-type: application/json' -d '{"name":"Ali","weight":1}' "$BASE/trips/$TRIP/participants" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["participant"]["id"]')
SARA=$(curl -s -b "$JAR" -H 'content-type: application/json' -d '{"name":"Sara","weight":1}' "$BASE/trips/$TRIP/participants" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["participant"]["id"]')
echo "ali=$ALI sara=$SARA"

echo "== upload receipt"
UP=$(curl -s -b "$JAR" -F "image=@$PNG;type=image/png" "$BASE/trips/$TRIP/receipts")
echo "$UP" | ruby -rjson -e 'r = JSON.parse(STDIN.read)["receipt"]; puts "id=#{r["id"]} status=#{r["status"]} bytes=#{r["sizeBytes"]} type=#{r["contentType"]}"'
RID=$(echo "$UP" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["receipt"]["id"]')

echo "== poll extraction (real local model — may take a while)"
for i in $(seq 1 60); do
  R=$(curl -s -b "$JAR" "$BASE/receipts/$RID")
  ST=$(echo "$R" | ruby -rjson -e 'puts JSON.parse(STDIN.read)["receipt"]["status"]')
  [ "$ST" = "extracted" ] || [ "$ST" = "failed" ] && break
  sleep 2
done
echo "$R" | ruby -rjson -e '
r = JSON.parse(STDIN.read)["receipt"]
puts "status=#{r["status"]} provider=#{r["providerUsed"]} fallback=#{(r["fallbackReason"] || "none")[0,120]}"
puts "error=#{(r["processingError"] || "none")[0,200]}"
e = r["extraction"]
if e
  %w[merchant date currency subtotal tax serviceCharge tip cashTendered total].each do |k|
    puts format("  %-14s %s", k, e[k].inspect)
  end
  puts "  warnings: #{e["warnings"].inspect}"
end'
[ "$ST" = "extracted" ] || { echo "EXTRACTION DID NOT SUCCEED"; exit 1; }

echo "== image streaming (owner)"
curl -s -b "$JAR" -o /tmp/billsplit-roundtrip.png -w 'image http=%{http_code} bytes=%{size_download}\n' "$BASE/receipts/$RID/image"
cmp -s "$PNG" /tmp/billsplit-roundtrip.png && echo "round-trip bytes match" || echo "BYTES DIFFER"

echo "== confirm expense from receipt (extra tip 3.00 on top of 42.00 = 45.00)"
curl -s -b "$JAR" -H 'content-type: application/json' -d "{
  \"description\":\"Dinner at Tandoor House\",
  \"amount\":\"42.00\",
  \"extraTip\":\"3.00\",
  \"payerParticipantId\":\"$ALI\",
  \"receiptId\":\"$RID\",
  \"participants\":[{\"participantId\":\"$ALI\",\"weight\":1},{\"participantId\":\"$SARA\",\"weight\":1}]
}" "$BASE/trips/$TRIP/expenses" | ruby -rjson -e '
e = JSON.parse(STDIN.read)["expense"]
puts "amountMinor=#{e["amountMinor"]} receiptId=#{e["receiptId"].inspect}"
puts "allocations: #{e["allocations"].map { |a| a["amountMinor"] }.inspect}"'

echo "== duplicate confirm must fail 409"
curl -s -o /dev/null -w 'second attach http=%{http_code}\n' -b "$JAR" -H 'content-type: application/json' -d "{
  \"description\":\"Duplicate\",
  \"amount\":\"42.00\",
  \"payerParticipantId\":\"$ALI\",
  \"receiptId\":\"$RID\",
  \"participants\":[{\"participantId\":\"$ALI\",\"weight\":1}]
}" "$BASE/trips/$TRIP/expenses"

echo "== trip balances"
curl -s -b "$JAR" "$BASE/trips/$TRIP" | ruby -rjson -e '
d = JSON.parse(STDIN.read)
puts "totalSpent=#{d["totals"]["totalSpentMinor"]} expenses=#{d["totals"]["expenseCount"]} receipts=#{d["receipts"].map { |r| "#{r["id"][0,4]}:#{r["status"]}" }.join(",")}"
d["balances"].each { |b| puts "  #{b["participantId"][0,4]} net=#{b["netMinor"]}" }'

echo "== foreign organizer isolation"
JAR2=/tmp/billsplit-stage3-other.cookies; rm -f "$JAR2"
curl -s -c "$JAR2" -H 'content-type: application/json' -d "{\"email\":\"stage3-other-$(date +%s)@test.local\",\"password\":\"password123\"}" "$BASE/auth/register" > /dev/null
curl -s -o /dev/null -w 'foreign GET receipt http=%{http_code}\n' -b "$JAR2" "$BASE/receipts/$RID"
curl -s -o /dev/null -w 'foreign GET image   http=%{http_code}\n' -b "$JAR2" "$BASE/receipts/$RID/image"

echo "== AI settings masked"
curl -s -b "$JAR" "$BASE/ai/settings"

echo
echo "LIVE SMOKE TEST DONE"
