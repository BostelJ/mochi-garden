#!/bin/sh
# Makes the self-signed certificate that `npm run ship` signs local Mac builds with, in your login
# keychain. Ad-hoc signed builds are identified by their exact hash, so macOS treats every new one
# as a new app and forgets its permissions (Screen Recording, Accessibility). Builds signed with one
# certificate keep the same identity. Only for builds you install yourself: nobody else trusts it.
# Run it once per Mac; running it again changes nothing.
#   sh tools/mac-signing-cert.sh
set -eu

NAME="Mochi Garden Local"

if security find-certificate -c "$NAME" >/dev/null 2>&1; then
  echo "$NAME is already in your keychain."
  exit 0
fi

dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
pass=$(openssl rand -hex 16)

cat >"$dir/cert.conf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$dir/cert.conf" \
  -keyout "$dir/key.pem" -out "$dir/cert.pem" 2>/dev/null
openssl pkcs12 -export -inkey "$dir/key.pem" -in "$dir/cert.pem" -name "$NAME" \
  -out "$dir/cert.p12" -passout "pass:$pass"
# -T lets codesign use the key, but macOS still asks in a dialog until "Always Allow" is chosen.
security import "$dir/cert.p12" -P "$pass" -T /usr/bin/codesign >/dev/null

echo "Made $NAME in your login keychain."
echo "The first time codesign asks to use its key, choose Always Allow: an update signs with it unattended."
