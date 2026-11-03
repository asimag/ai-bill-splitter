#!/bin/bash
# Stage 1 end-to-end API verification against a live server + database.
# Usage: start the API (npm run dev -w @billsplit/server) with a clean or throwaway DB, then: bash scripts/e2e-stage1.sh
set -u
API=http://localhost:8787/api
JA=/tmp/bs-alice.jar
JB=/tmp/bs-bob.jar
rm -f $JA $JB
pass=0; fail=0
check() { # check <desc> <actual> <expected>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "PASS: $1"; else fail=$((fail+1)); echo "FAIL: $1 — got [$2] want [$3]"; fi
}

# --- auth ---
login_or_register() { # login_or_register <jar> <email> <password>
  local jar=$1 email=$2 password=$3
  curl -s -c "$jar" -X POST $API/auth/login -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}" | grep -q organizer || \
    curl -s -c "$jar" -X POST $API/auth/register -H 'content-type: application/json' \
      -d "{\"email\":\"$email\",\"password\":\"$password\"}"
}
check "health" "$(curl -s $API/health)" '{"ok":true}'
check "unauthenticated trips -> 401" "$(curl -s -o /dev/null -w '%{http_code}' $API/trips)" "401"
login_or_register $JA alice@test.local password123 > /dev/null
check "register alice" "$(curl -s -b $JA $API/auth/me | jq -r .organizer.email)" "alice@test.local"
check "short password rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/auth/register -H 'content-type: application/json' -d '{"email":"x@test.local","password":"short"}')" "400"
check "duplicate email rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/auth/register -H 'content-type: application/json' -d '{"email":"alice@test.local","password":"password123"}')" "400"
check "wrong password rejected" "$(curl -s -o /dev/null -w '%{http_code}' -X POST $API/auth/login -H 'content-type: application/json' -d '{"email":"alice@test.local","password":"wrong-pass"}')" "401"
login_or_register $JB bob@test.local password456 > /dev/null

# --- trip + participants (alice) ---
TRIP=$(curl -s -b $JA -X POST $API/trips -H 'content-type: application/json' -d '{"name":"Weekend dinner","currency":"USD"}' | jq -r .trip.id)
check "trip created" "$(echo -n $TRIP | wc -c | tr -d ' ')" "36"
for w in 1 2 1; do :; done
ALI=$(curl -s -b $JA -X POST $API/trips/$TRIP/participants -H 'content-type: application/json' -d '{"name":"Ali","weight":1}' | jq -r .participant.id)
SARA=$(curl -s -b $JA -X POST $API/trips/$TRIP/participants -H 'content-type: application/json' -d '{"name":"Sara","weight":2}' | jq -r .participant.id)
AHMED=$(curl -s -b $JA -X POST $API/trips/$TRIP/participants -H 'content-type: application/json' -d '{"name":"Ahmed","weight":1}' | jq -r .participant.id)
check "zero weight rejected" "$(curl -s -o /dev/null -w '%{http_code}' -b $JA -X POST $API/trips/$TRIP/participants -H 'content-type: application/json' -d '{"name":"Zero","weight":0}')" "400"

# --- example 1: 6,000 minor units at 1:2:1 -> 1500/3000/1500 ---
E1=$(curl -s -b $JA -X POST $API/trips/$TRIP/expenses -H 'content-type: application/json' \
  -d "{\"description\":\"Dinner\",\"amount\":\"60.00\",\"payerParticipantId\":\"$ALI\",\"participants\":[{\"participantId\":\"$ALI\",\"weight\":1},{\"participantId\":\"$SARA\",\"weight\":2},{\"participantId\":\"$AHMED\",\"weight\":1}]}")
check "6000 @1:2:1 -> 1500/3000/1500" "$(echo "$E1" | jq -c '[.expense.allocations[].amountMinor]')" "[1500,3000,1500]"
E1_ID=$(echo "$E1" | jq -r .expense.id)

# --- invalid inputs ---
check "negative amount rejected" "$(curl -s -o /dev/null -w '%{http_code}' -b $JA -X POST $API/trips/$TRIP/expenses -H 'content-type: application/json' -d "{\"description\":\"bad\",\"amount\":\"-5\",\"payerParticipantId\":\"$ALI\",\"participants\":[{\"participantId\":\"$ALI\",\"weight\":1}]}")" "400"
check "no participants rejected" "$(curl -s -o /dev/null -w '%{http_code}' -b $JA -X POST $API/trips/$TRIP/expenses -H 'content-type: application/json' -d "{\"description\":\"bad\",\"amount\":\"5\",\"payerParticipantId\":\"$ALI\",\"participants\":[]}")" "400"
check "foreign payer rejected" "$(curl -s -o /dev/null -w '%{http_code}' -b $JA -X POST $API/trips/$TRIP/expenses -H 'content-type: application/json' -d "{\"description\":\"bad\",\"amount\":\"5\",\"payerParticipantId\":\"00000000-0000-0000-0000-000000000001\",\"participants\":[{\"participantId\":\"$ALI\",\"weight\":1}]}")" "400"
check "too-precise amount rejected" "$(curl -s -o /dev/null -w '%{http_code}' -b $JA -X POST $API/trips/$TRIP/expenses -H 'content-type: application/json' -d "{\"description\":\"bad\",\"amount\":\"5.999\",\"payerParticipantId\":\"$ALI\",\"participants\":[{\"participantId\":\"$ALI\",\"weight\":1}]}")" "400"

# --- example 2: 9,000 total at 1:2:1; Ali pays 6,000, Sara 3,000 ---
for i in 1 2 3; do
  curl -s -b $JA -X POST $API/trips/$TRIP/expenses -H 'content-type: application/json' \
    -d "{\"description\":\"Meal $i\",\"amount\":\"20.00\",\"payerParticipantId\":\"$ALI\",\"participants\":[{\"participantId\":\"$ALI\",\"weight\":1},{\"participantId\":\"$SARA\",\"weight\":2},{\"participantId\":\"$AHMED\",\"weight\":1}]}" > /dev/null
done
curl -s -b $JA -X POST $API/trips/$TRIP/expenses -H 'content-type: application/json' \
  -d "{\"description\":\"Hotel share\",\"amount\":\"30.00\",\"payerParticipantId\":\"$SARA\",\"participants\":[{\"participantId\":\"$ALI\",\"weight\":1},{\"participantId\":\"$SARA\",\"weight\":2},{\"participantId\":\"$AHMED\",\"weight\":1}]}" > /dev/null
# delete example-1 dinner (6000) so totals are exactly the 9,000 scenario
curl -s -b $JA -X DELETE $API/expenses/$E1_ID > /dev/null
BAL=$(curl -s -b $JA $API/trips/$TRIP)
NET=$(echo "$BAL" | jq -c "[.balances[] | {(.participantId): .netMinor}] ")
NAME_NET() { echo "$BAL" | jq -r --arg id "$1" '.balances[] | select(.participantId==$id) | .netMinor'; }
check "Ali net +3750" "$(NAME_NET $ALI)" "3750"
check "Sara net -1500" "$(NAME_NET $SARA)" "-1500"
check "Ahmed net -2250" "$(NAME_NET $AHMED)" "-2250"
SUM=$(echo "$BAL" | jq '[.balances[].netMinor] | add')
check "net balances sum to zero" "$SUM" "0"
SHARES=$(echo "$BAL" | jq -r '[.expenses[].allocations[].amountMinor] | add')
TOTAL=$(echo "$BAL" | jq '.totals.totalSpentMinor')
check "allocations sum == total spent" "$SHARES" "$TOTAL"

# --- rounding: 100 minor units (1.00 USD) among three equal weights -> 34/33/33 ---
T2=$(curl -s -b $JA -X POST $API/trips -H 'content-type: application/json' -d '{"name":"Rounding","currency":"USD"}' | jq -r .trip.id)
P1=$(curl -s -b $JA -X POST $API/trips/$T2/participants -H 'content-type: application/json' -d '{"name":"One"}' | jq -r .participant.id)
P2=$(curl -s -b $JA -X POST $API/trips/$T2/participants -H 'content-type: application/json' -d '{"name":"Two"}' | jq -r .participant.id)
P3=$(curl -s -b $JA -X POST $API/trips/$T2/participants -H 'content-type: application/json' -d '{"name":"Three"}' | jq -r .participant.id)
E2=$(curl -s -b $JA -X POST $API/trips/$T2/expenses -H 'content-type: application/json' \
  -d "{\"description\":\"Cent test\",\"amount\":\"1.00\",\"payerParticipantId\":\"$P1\",\"participants\":[{\"participantId\":\"$P1\",\"weight\":1},{\"participantId\":\"$P2\",\"weight\":1},{\"participantId\":\"$P3\",\"weight\":1}]}")
check "100 units 3-way -> 34/33/33 stable order" "$(echo "$E2" | jq -c '[.expense.allocations[].amountMinor]')" "[34,33,33]"

# --- excluded participant gets zero; weight snapshot survives default change ---
E3=$(curl -s -b $JA -X POST $API/trips/$T2/expenses -H 'content-type: application/json' \
  -d "{\"description\":\"Two only\",\"amount\":\"10.00\",\"payerParticipantId\":\"$P3\",\"participants\":[{\"participantId\":\"$P1\",\"weight\":1},{\"participantId\":\"$P2\",\"weight\":1}]}")
check "excluded participant has no allocation" "$(echo "$E3" | jq '[.expense.allocations[] | select(.participantId=="'$P3'")] | length')" "0"
E3_ID=$(echo "$E3" | jq -r .expense.id)
curl -s -b $JA -X PATCH $API/participants/$P1 -H 'content-type: application/json' -d '{"defaultWeight":9}' > /dev/null
check "old expense keeps snapshotted weight 1" "$(curl -s -b $JA $API/trips/$T2 | jq -r --arg e $E3_ID '.expenses[] | select(.id==$e) | .allocations[0].weight')" "1"
check "participant default updated" "$(curl -s -b $JA $API/trips/$T2 | jq -r --arg p $P1 '.participants[] | select(.id==$p) | .defaultWeight')" "9"

# --- edit expense keeps allocations exact ---
curl -s -b $JA -X PUT $API/expenses/$E3_ID -H 'content-type: application/json' \
  -d "{\"description\":\"Two only v2\",\"amount\":\"10.01\",\"payerParticipantId\":\"$P3\",\"participants\":[{\"participantId\":\"$P1\",\"weight\":1},{\"participantId\":\"$P2\",\"weight\":1}]}" > /dev/null
check "edited expense exact (501/500)" "$(curl -s -b $JA $API/trips/$T2 | jq -r --arg e $E3_ID '.expenses[] | select(.id==$e) | [.allocations[].amountMinor] | @csv')" "501,500"

# --- archive + use of archived participant ---
curl -s -b $JA -X PATCH $API/participants/$P2 -H 'content-type: application/json' -d '{"archived":true}' > /dev/null
check "archived participant rejected in new expense" "$(curl -s -o /dev/null -w '%{http_code}' -b $JA -X POST $API/trips/$T2/expenses -H 'content-type: application/json' -d "{\"description\":\"bad\",\"amount\":\"5\",\"payerParticipantId\":\"$P2\",\"participants\":[{\"participantId\":\"$P2\",\"weight\":1}]}")" "400"
check "archived participant keeps history" "$(curl -s -b $JA $API/trips/$T2 | jq -r --arg p $P2 '[.participants[] | select(.id==$p)][0].archived')" "true"

# --- currency precision: JPY (0 decimals) ---
T3=$(curl -s -b $JA -X POST $API/trips -H 'content-type: application/json' -d '{"name":"Tokyo","currency":"JPY"}' | jq -r .trip.id)
J1=$(curl -s -b $JA -X POST $API/trips/$T3/participants -H 'content-type: application/json' -d '{"name":"Hana"}' | jq -r .participant.id)
E4=$(curl -s -b $JA -X POST $API/trips/$T3/expenses -H 'content-type: application/json' -d "{\"description\":\"Ramen\",\"amount\":\"4550\",\"payerParticipantId\":\"$J1\",\"participants\":[{\"participantId\":\"$J1\",\"weight\":1}]}")
check "JPY 4550 -> 4550 minor" "$(echo "$E4" | jq '.expense.amountMinor')" "4550"
check "JPY decimal amount rejected" "$(curl -s -o /dev/null -w '%{http_code}' -b $JA -X POST $API/trips/$T3/expenses -H 'content-type: application/json' -d "{\"description\":\"bad\",\"amount\":\"4550.5\",\"payerParticipantId\":\"$J1\",\"participants\":[{\"participantId\":\"$J1\",\"weight\":1}]}")" "400"

# --- organizer isolation ---
check "bob cannot read alice trip" "$(curl -s -o /dev/null -w '%{http_code}' -b $JB $API/trips/$TRIP)" "404"
check "bob cannot create in alice trip" "$(curl -s -o /dev/null -w '%{http_code}' -b $JB -X POST $API/trips/$TRIP/expenses -H 'content-type: application/json' -d '{"description":"x","amount":"1","payerParticipantId":"'$ALI'","participants":[{"participantId":"'$ALI'","weight":1}]}')" "404"
check "bob cannot patch alice participant" "$(curl -s -o /dev/null -w '%{http_code}' -b $JB -X PATCH $API/participants/$ALI -H 'content-type: application/json' -d '{"name":"hacked"}')" "404"
check "bob cannot delete alice expense" "$(curl -s -o /dev/null -w '%{http_code}' -b $JB -X DELETE $API/expenses/$E3_ID)" "404"
check "bob cannot delete alice trip" "$(curl -s -o /dev/null -w '%{http_code}' -b $JB -X DELETE $API/trips/$TRIP)" "404"
check "alice trip intact" "$(curl -s -b $JA $API/trips/$TRIP | jq -r .trip.name)" "Weekend dinner"

# --- logout ---
curl -s -b $JA -c $JA -X POST $API/auth/logout > /dev/null
check "after logout -> 401" "$(curl -s -o /dev/null -w '%{http_code}' -b $JA $API/trips)" "401"
check "login again" "$(curl -s -c $JA -o /dev/null -w '%{http_code}' -X POST $API/auth/login -H 'content-type: application/json' -d '{"email":"alice@test.local","password":"password123"}')" "200"

echo
echo "RESULT: $pass passed, $fail failed"
[ $fail -eq 0 ]
