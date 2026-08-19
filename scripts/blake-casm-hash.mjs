// blake-casm-hash.mjs — compute the BLAKE2s compiled class hash of a CASM file.
// Starknet >=0.14.1 switched compiled class hashes from Poseidon to BLAKE2s;
// starkli 0.4 still computes Poseidon hashes, so declaring requires passing
// --casm-hash with this value.
import { hash } from "starknet";
import fs from "fs";

const casm = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
console.log(hash.computeCompiledClassHash(casm));