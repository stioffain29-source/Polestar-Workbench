#!/bin/bash
declare -A flags=(
  ["Australia"]="au" ["Bangladesh"]="bd" ["Bhutan"]="bt" ["Brunei"]="bn"
  ["Cambodia"]="kh" ["China"]="cn" ["Fiji"]="fj" ["Hong Kong"]="hk"
  ["India"]="in" ["Indonesia"]="id" ["Japan"]="jp" ["Kiribati"]="ki"
  ["Laos"]="la" ["Malaysia"]="my" ["Maldives"]="mv" ["Marshall Islands"]="mh"
  ["Micronesia"]="fm" ["Mongolia"]="mn" ["Myanmar"]="mm" ["Nauru"]="nr"
  ["Nepal"]="np" ["New Zealand"]="nz" ["North Korea"]="kp" ["Pakistan"]="pk"
  ["Palau"]="pw" ["Papua New Guinea"]="pg" ["Philippines"]="ph" ["Samoa"]="ws"
  ["Singapore"]="sg" ["Solomon Islands"]="sb" ["South Korea"]="kr" ["Sri Lanka"]="lk"
  ["Taiwan"]="tw" ["Thailand"]="th" ["Timor-Leste"]="tl" ["Tonga"]="to"
  ["Tuvalu"]="tv" ["Vanuatu"]="vu" ["Vietnam"]="vn"
)
mkdir -p artifacts/workbench/public/assets/flags
for country in "${!flags[@]}"; do
  code="${flags[$country]}"
  # URL encode the country name to avoid spaces in filename issue, but it's simpler to just replace spaces with dashes or keep as is?
  # Let's save as ISO code, then map country to ISO code in TS.
  curl -s -L "https://raw.githubusercontent.com/lipis/flag-icons/main/flags/4x3/$code.svg" -o "artifacts/workbench/public/assets/flags/$code.svg"
done
