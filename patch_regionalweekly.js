const fs = require('fs');
const file = 'artifacts/workbench/src/lib/regionalWeekly.ts';
let code = fs.readFileSync(file, 'utf8');

const oldApacMapItem = `export interface ApacMapItem {
  id: number;
  country: string;
  flag: string;
  lat: number;
  lng: number;`;
const newApacMapItem = `export interface ApacMapItem {
  id: number;
  country: string;
  lat: number;
  lng: number;`;
code = code.replace(oldApacMapItem, newApacMapItem);

const oldCountryFlags = `const COUNTRY_FLAGS: Record<string, string> = {
  "Australia": "au", "Bangladesh": "bd", "Bhutan": "bt", "Brunei": "bn",
  "Cambodia": "kh", "China": "cn", "Fiji": "fj", "Hong Kong": "hk",
  "India": "in", "Indonesia": "id", "Japan": "jp", "Kiribati": "ki",
  "Laos": "la", "Malaysia": "my", "Maldives": "mv", "Marshall Islands": "mh",
  "Micronesia": "fm", "Mongolia": "mn", "Myanmar": "mm", "Nauru": "nr",
  "Nepal": "np", "New Zealand": "nz", "North Korea": "kp", "Pakistan": "pk",
  "Palau": "pw", "Papua New Guinea": "pg", "Philippines": "ph", "Samoa": "ws",
  "Singapore": "sg", "Solomon Islands": "sb", "South Korea": "kr", "Sri Lanka": "lk",
  "Taiwan": "tw", "Thailand": "th", "Timor-Leste": "tl", "Tonga": "to",
  "Tuvalu": "tv", "Vanuatu": "vu", "Vietnam": "vn"
};`;
code = code.replace(oldCountryFlags, "");

const oldMapReturn = `    return {
      id: idCounter++,
      country,
      flag: COUNTRY_FLAGS[country] ?? "",
      lat: representative.latitude!,
      lng: representative.longitude!,`;
const newMapReturn = `    return {
      id: idCounter++,
      country,
      lat: representative.latitude!,
      lng: representative.longitude!,`;
code = code.replace(oldMapReturn, newMapReturn);

fs.writeFileSync(file, code);
