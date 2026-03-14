// src/analyze/index.mjs
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

// src/shared/jwt.mjs
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

// node_modules/jose/dist/node/esm/runtime/base64url.js
import { Buffer as Buffer2 } from "node:buffer";

// node_modules/jose/dist/node/esm/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}

// node_modules/jose/dist/node/esm/runtime/base64url.js
function normalize(input) {
  let encoded = input;
  if (encoded instanceof Uint8Array) {
    encoded = decoder.decode(encoded);
  }
  return encoded;
}
var decode = (input) => new Uint8Array(Buffer2.from(normalize(input), "base64url"));

// node_modules/jose/dist/node/esm/util/errors.js
var JOSEError = class extends Error {
  static code = "ERR_JOSE_GENERIC";
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
var JWTClaimValidationFailed = class extends JOSEError {
  static code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JWTExpired = class extends JOSEError {
  static code = "ERR_JWT_EXPIRED";
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
var JOSEAlgNotAllowed = class extends JOSEError {
  static code = "ERR_JOSE_ALG_NOT_ALLOWED";
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
var JOSENotSupported = class extends JOSEError {
  static code = "ERR_JOSE_NOT_SUPPORTED";
  code = "ERR_JOSE_NOT_SUPPORTED";
};
var JWSInvalid = class extends JOSEError {
  static code = "ERR_JWS_INVALID";
  code = "ERR_JWS_INVALID";
};
var JWTInvalid = class extends JOSEError {
  static code = "ERR_JWT_INVALID";
  code = "ERR_JWT_INVALID";
};
var JWSSignatureVerificationFailed = class extends JOSEError {
  static code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};

// node_modules/jose/dist/node/esm/runtime/is_key_object.js
import * as util from "node:util";
var is_key_object_default = (obj) => util.types.isKeyObject(obj);

// node_modules/jose/dist/node/esm/runtime/webcrypto.js
import * as crypto from "node:crypto";
import * as util2 from "node:util";
var webcrypto2 = crypto.webcrypto;
var webcrypto_default = webcrypto2;
var isCryptoKey = (key) => util2.types.isCryptoKey(key);

// node_modules/jose/dist/node/esm/lib/crypto_key.js
function unusable(name, prop = "algorithm.name") {
  return new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`);
}
function isAlgorithm(algorithm, name) {
  return algorithm.name === name;
}
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
function checkUsage(key, usages) {
  if (usages.length && !usages.some((expected) => key.usages.includes(expected))) {
    let msg = "CryptoKey does not support this operation, its usages must include ";
    if (usages.length > 2) {
      const last = usages.pop();
      msg += `one of ${usages.join(", ")}, or ${last}.`;
    } else if (usages.length === 2) {
      msg += `one of ${usages[0]} or ${usages[1]}.`;
    } else {
      msg += `${usages[0]}.`;
    }
    throw new TypeError(msg);
  }
}
function checkSigCryptoKey(key, alg, ...usages) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key.algorithm, "HMAC"))
        throw unusable("HMAC");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      const expected = parseInt(alg.slice(2), 10);
      const actual = getHashLength(key.algorithm.hash);
      if (actual !== expected)
        throw unusable(`SHA-${expected}`, "algorithm.hash");
      break;
    }
    case "EdDSA": {
      if (key.algorithm.name !== "Ed25519" && key.algorithm.name !== "Ed448") {
        throw unusable("Ed25519 or Ed448");
      }
      break;
    }
    case "Ed25519": {
      if (!isAlgorithm(key.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key, usages);
}

// node_modules/jose/dist/node/esm/lib/invalid_key_input.js
function message(msg, actual, ...types4) {
  types4 = types4.filter(Boolean);
  if (types4.length > 2) {
    const last = types4.pop();
    msg += `one of type ${types4.join(", ")}, or ${last}.`;
  } else if (types4.length === 2) {
    msg += `one of type ${types4[0]} or ${types4[1]}.`;
  } else {
    msg += `of type ${types4[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
var invalid_key_input_default = (actual, ...types4) => {
  return message("Key must be ", actual, ...types4);
};
function withAlg(alg, actual, ...types4) {
  return message(`Key for the ${alg} algorithm must be `, actual, ...types4);
}

// node_modules/jose/dist/node/esm/runtime/is_key_like.js
var is_key_like_default = (key) => is_key_object_default(key) || isCryptoKey(key);
var types3 = ["KeyObject"];
if (globalThis.CryptoKey || webcrypto_default?.CryptoKey) {
  types3.push("CryptoKey");
}

// node_modules/jose/dist/node/esm/lib/is_disjoint.js
var isDisjoint = (...headers) => {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
};
var is_disjoint_default = isDisjoint;

// node_modules/jose/dist/node/esm/lib/is_object.js
function isObjectLike(value) {
  return typeof value === "object" && value !== null;
}
function isObject(input) {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
}

// node_modules/jose/dist/node/esm/runtime/get_named_curve.js
import { KeyObject } from "node:crypto";

// node_modules/jose/dist/node/esm/lib/is_jwk.js
function isJWK(key) {
  return isObject(key) && typeof key.kty === "string";
}
function isPrivateJWK(key) {
  return key.kty !== "oct" && typeof key.d === "string";
}
function isPublicJWK(key) {
  return key.kty !== "oct" && typeof key.d === "undefined";
}
function isSecretJWK(key) {
  return isJWK(key) && key.kty === "oct" && typeof key.k === "string";
}

// node_modules/jose/dist/node/esm/runtime/get_named_curve.js
var namedCurveToJOSE = (namedCurve) => {
  switch (namedCurve) {
    case "prime256v1":
      return "P-256";
    case "secp384r1":
      return "P-384";
    case "secp521r1":
      return "P-521";
    case "secp256k1":
      return "secp256k1";
    default:
      throw new JOSENotSupported("Unsupported key curve for this operation");
  }
};
var getNamedCurve2 = (kee, raw) => {
  let key;
  if (isCryptoKey(kee)) {
    key = KeyObject.from(kee);
  } else if (is_key_object_default(kee)) {
    key = kee;
  } else if (isJWK(kee)) {
    return kee.crv;
  } else {
    throw new TypeError(invalid_key_input_default(kee, ...types3));
  }
  if (key.type === "secret") {
    throw new TypeError('only "private" or "public" type keys can be used for this operation');
  }
  switch (key.asymmetricKeyType) {
    case "ed25519":
    case "ed448":
      return `Ed${key.asymmetricKeyType.slice(2)}`;
    case "x25519":
    case "x448":
      return `X${key.asymmetricKeyType.slice(1)}`;
    case "ec": {
      const namedCurve = key.asymmetricKeyDetails.namedCurve;
      if (raw) {
        return namedCurve;
      }
      return namedCurveToJOSE(namedCurve);
    }
    default:
      throw new TypeError("Invalid asymmetric key type for this operation");
  }
};
var get_named_curve_default = getNamedCurve2;

// node_modules/jose/dist/node/esm/runtime/check_key_length.js
import { KeyObject as KeyObject2 } from "node:crypto";
var check_key_length_default = (key, alg) => {
  let modulusLength;
  try {
    if (key instanceof KeyObject2) {
      modulusLength = key.asymmetricKeyDetails?.modulusLength;
    } else {
      modulusLength = Buffer.from(key.n, "base64url").byteLength << 3;
    }
  } catch {
  }
  if (typeof modulusLength !== "number" || modulusLength < 2048) {
    throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
  }
};

// node_modules/jose/dist/node/esm/runtime/jwk_to_key.js
import { createPrivateKey, createPublicKey } from "node:crypto";
var parse = (key) => {
  if (key.d) {
    return createPrivateKey({ format: "jwk", key });
  }
  return createPublicKey({ format: "jwk", key });
};
var jwk_to_key_default = parse;

// node_modules/jose/dist/node/esm/key/import.js
async function importJWK(jwk, alg) {
  if (!isObject(jwk)) {
    throw new TypeError("JWK must be an object");
  }
  alg ||= jwk.alg;
  switch (jwk.kty) {
    case "oct":
      if (typeof jwk.k !== "string" || !jwk.k) {
        throw new TypeError('missing "k" (Key Value) Parameter value');
      }
      return decode(jwk.k);
    case "RSA":
      if ("oth" in jwk && jwk.oth !== void 0) {
        throw new JOSENotSupported('RSA JWK "oth" (Other Primes Info) Parameter value is not supported');
      }
    case "EC":
    case "OKP":
      return jwk_to_key_default({ ...jwk, alg });
    default:
      throw new JOSENotSupported('Unsupported "kty" (Key Type) Parameter value');
  }
}

// node_modules/jose/dist/node/esm/lib/check_key_type.js
var tag = (key) => key?.[Symbol.toStringTag];
var jwkMatchesOp = (alg, key, usage) => {
  if (key.use !== void 0 && key.use !== "sig") {
    throw new TypeError("Invalid key for this operation, when present its use must be sig");
  }
  if (key.key_ops !== void 0 && key.key_ops.includes?.(usage) !== true) {
    throw new TypeError(`Invalid key for this operation, when present its key_ops must include ${usage}`);
  }
  if (key.alg !== void 0 && key.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, when present its alg must be ${alg}`);
  }
  return true;
};
var symmetricTypeCheck = (alg, key, usage, allowJwk) => {
  if (key instanceof Uint8Array)
    return;
  if (allowJwk && isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types3, "Uint8Array", allowJwk ? "JSON Web Key" : null));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
};
var asymmetricTypeCheck = (alg, key, usage, allowJwk) => {
  if (allowJwk && isJWK(key)) {
    switch (usage) {
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a private JWK`);
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation be a public JWK`);
    }
  }
  if (!is_key_like_default(key)) {
    throw new TypeError(withAlg(alg, key, ...types3, allowJwk ? "JSON Web Key" : null));
  }
  if (key.type === "secret") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (usage === "sign" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
  }
  if (usage === "decrypt" && key.type === "public") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
  }
  if (key.algorithm && usage === "verify" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
  }
  if (key.algorithm && usage === "encrypt" && key.type === "private") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
  }
};
function checkKeyType(allowJwk, alg, key, usage) {
  const symmetric = alg.startsWith("HS") || alg === "dir" || alg.startsWith("PBES2") || /^A\d{3}(?:GCM)?KW$/.test(alg);
  if (symmetric) {
    symmetricTypeCheck(alg, key, usage, allowJwk);
  } else {
    asymmetricTypeCheck(alg, key, usage, allowJwk);
  }
}
var check_key_type_default = checkKeyType.bind(void 0, false);
var checkKeyTypeWithJwk = checkKeyType.bind(void 0, true);

// node_modules/jose/dist/node/esm/lib/validate_crit.js
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
}
var validate_crit_default = validateCrit;

// node_modules/jose/dist/node/esm/lib/validate_algorithms.js
var validateAlgorithms = (option, algorithms) => {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s !== "string"))) {
    throw new TypeError(`"${option}" option must be an array of strings`);
  }
  if (!algorithms) {
    return void 0;
  }
  return new Set(algorithms);
};
var validate_algorithms_default = validateAlgorithms;

// node_modules/jose/dist/node/esm/runtime/verify.js
import * as crypto3 from "node:crypto";
import { promisify as promisify2 } from "node:util";

// node_modules/jose/dist/node/esm/runtime/dsa_digest.js
function dsaDigest(alg) {
  switch (alg) {
    case "PS256":
    case "RS256":
    case "ES256":
    case "ES256K":
      return "sha256";
    case "PS384":
    case "RS384":
    case "ES384":
      return "sha384";
    case "PS512":
    case "RS512":
    case "ES512":
      return "sha512";
    case "Ed25519":
    case "EdDSA":
      return void 0;
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}

// node_modules/jose/dist/node/esm/runtime/node_key.js
import { constants, KeyObject as KeyObject3 } from "node:crypto";
var ecCurveAlgMap = /* @__PURE__ */ new Map([
  ["ES256", "P-256"],
  ["ES256K", "secp256k1"],
  ["ES384", "P-384"],
  ["ES512", "P-521"]
]);
function keyForCrypto(alg, key) {
  let asymmetricKeyType;
  let asymmetricKeyDetails;
  let isJWK2;
  if (key instanceof KeyObject3) {
    asymmetricKeyType = key.asymmetricKeyType;
    asymmetricKeyDetails = key.asymmetricKeyDetails;
  } else {
    isJWK2 = true;
    switch (key.kty) {
      case "RSA":
        asymmetricKeyType = "rsa";
        break;
      case "EC":
        asymmetricKeyType = "ec";
        break;
      case "OKP": {
        if (key.crv === "Ed25519") {
          asymmetricKeyType = "ed25519";
          break;
        }
        if (key.crv === "Ed448") {
          asymmetricKeyType = "ed448";
          break;
        }
        throw new TypeError("Invalid key for this operation, its crv must be Ed25519 or Ed448");
      }
      default:
        throw new TypeError("Invalid key for this operation, its kty must be RSA, OKP, or EC");
    }
  }
  let options;
  switch (alg) {
    case "Ed25519":
      if (asymmetricKeyType !== "ed25519") {
        throw new TypeError(`Invalid key for this operation, its asymmetricKeyType must be ed25519`);
      }
      break;
    case "EdDSA":
      if (!["ed25519", "ed448"].includes(asymmetricKeyType)) {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ed25519 or ed448");
      }
      break;
    case "RS256":
    case "RS384":
    case "RS512":
      if (asymmetricKeyType !== "rsa") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa");
      }
      check_key_length_default(key, alg);
      break;
    case "PS256":
    case "PS384":
    case "PS512":
      if (asymmetricKeyType === "rsa-pss") {
        const { hashAlgorithm, mgf1HashAlgorithm, saltLength } = asymmetricKeyDetails;
        const length = parseInt(alg.slice(-3), 10);
        if (hashAlgorithm !== void 0 && (hashAlgorithm !== `sha${length}` || mgf1HashAlgorithm !== hashAlgorithm)) {
          throw new TypeError(`Invalid key for this operation, its RSA-PSS parameters do not meet the requirements of "alg" ${alg}`);
        }
        if (saltLength !== void 0 && saltLength > length >> 3) {
          throw new TypeError(`Invalid key for this operation, its RSA-PSS parameter saltLength does not meet the requirements of "alg" ${alg}`);
        }
      } else if (asymmetricKeyType !== "rsa") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be rsa or rsa-pss");
      }
      check_key_length_default(key, alg);
      options = {
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST
      };
      break;
    case "ES256":
    case "ES256K":
    case "ES384":
    case "ES512": {
      if (asymmetricKeyType !== "ec") {
        throw new TypeError("Invalid key for this operation, its asymmetricKeyType must be ec");
      }
      const actual = get_named_curve_default(key);
      const expected = ecCurveAlgMap.get(alg);
      if (actual !== expected) {
        throw new TypeError(`Invalid key curve for the algorithm, its curve must be ${expected}, got ${actual}`);
      }
      options = { dsaEncoding: "ieee-p1363" };
      break;
    }
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
  if (isJWK2) {
    return { format: "jwk", key, ...options };
  }
  return options ? { ...options, key } : key;
}

// node_modules/jose/dist/node/esm/runtime/sign.js
import * as crypto2 from "node:crypto";
import { promisify } from "node:util";

// node_modules/jose/dist/node/esm/runtime/hmac_digest.js
function hmacDigest(alg) {
  switch (alg) {
    case "HS256":
      return "sha256";
    case "HS384":
      return "sha384";
    case "HS512":
      return "sha512";
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}

// node_modules/jose/dist/node/esm/runtime/get_sign_verify_key.js
import { KeyObject as KeyObject4, createSecretKey } from "node:crypto";
function getSignVerifyKey(alg, key, usage) {
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalid_key_input_default(key, ...types3));
    }
    return createSecretKey(key);
  }
  if (key instanceof KeyObject4) {
    return key;
  }
  if (isCryptoKey(key)) {
    checkSigCryptoKey(key, alg, usage);
    return KeyObject4.from(key);
  }
  if (isJWK(key)) {
    if (alg.startsWith("HS")) {
      return createSecretKey(Buffer.from(key.k, "base64url"));
    }
    return key;
  }
  throw new TypeError(invalid_key_input_default(key, ...types3, "Uint8Array", "JSON Web Key"));
}

// node_modules/jose/dist/node/esm/runtime/sign.js
var oneShotSign = promisify(crypto2.sign);
var sign2 = async (alg, key, data) => {
  const k = getSignVerifyKey(alg, key, "sign");
  if (alg.startsWith("HS")) {
    const hmac = crypto2.createHmac(hmacDigest(alg), k);
    hmac.update(data);
    return hmac.digest();
  }
  return oneShotSign(dsaDigest(alg), data, keyForCrypto(alg, k));
};
var sign_default = sign2;

// node_modules/jose/dist/node/esm/runtime/verify.js
var oneShotVerify = promisify2(crypto3.verify);
var verify2 = async (alg, key, signature, data) => {
  const k = getSignVerifyKey(alg, key, "verify");
  if (alg.startsWith("HS")) {
    const expected = await sign_default(alg, k, data);
    const actual = signature;
    try {
      return crypto3.timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  }
  const algorithm = dsaDigest(alg);
  const keyInput = keyForCrypto(alg, k);
  try {
    return await oneShotVerify(algorithm, data, keyInput, signature);
  } catch {
    return false;
  }
};
var verify_default = verify2;

// node_modules/jose/dist/node/esm/jws/flattened/verify.js
async function flattenedVerify(jws, key, options) {
  if (!isObject(jws)) {
    throw new JWSInvalid("Flattened JWS must be an object");
  }
  if (jws.protected === void 0 && jws.header === void 0) {
    throw new JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
  }
  if (jws.protected !== void 0 && typeof jws.protected !== "string") {
    throw new JWSInvalid("JWS Protected Header incorrect type");
  }
  if (jws.payload === void 0) {
    throw new JWSInvalid("JWS Payload missing");
  }
  if (typeof jws.signature !== "string") {
    throw new JWSInvalid("JWS Signature missing or incorrect type");
  }
  if (jws.header !== void 0 && !isObject(jws.header)) {
    throw new JWSInvalid("JWS Unprotected Header incorrect type");
  }
  let parsedProt = {};
  if (jws.protected) {
    try {
      const protectedHeader = decode(jws.protected);
      parsedProt = JSON.parse(decoder.decode(protectedHeader));
    } catch {
      throw new JWSInvalid("JWS Protected Header is invalid");
    }
  }
  if (!is_disjoint_default(parsedProt, jws.header)) {
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  }
  const joseHeader = {
    ...parsedProt,
    ...jws.header
  };
  const extensions = validate_crit_default(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
  let b64 = true;
  if (extensions.has("b64")) {
    b64 = parsedProt.b64;
    if (typeof b64 !== "boolean") {
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    }
  }
  const { alg } = joseHeader;
  if (typeof alg !== "string" || !alg) {
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  }
  const algorithms = options && validate_algorithms_default("algorithms", options.algorithms);
  if (algorithms && !algorithms.has(alg)) {
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  }
  if (b64) {
    if (typeof jws.payload !== "string") {
      throw new JWSInvalid("JWS Payload must be a string");
    }
  } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  }
  let resolvedKey = false;
  if (typeof key === "function") {
    key = await key(parsedProt, jws);
    resolvedKey = true;
    checkKeyTypeWithJwk(alg, key, "verify");
    if (isJWK(key)) {
      key = await importJWK(key, alg);
    }
  } else {
    checkKeyTypeWithJwk(alg, key, "verify");
  }
  const data = concat(encoder.encode(jws.protected ?? ""), encoder.encode("."), typeof jws.payload === "string" ? encoder.encode(jws.payload) : jws.payload);
  let signature;
  try {
    signature = decode(jws.signature);
  } catch {
    throw new JWSInvalid("Failed to base64url decode the signature");
  }
  const verified = await verify_default(alg, key, signature, data);
  if (!verified) {
    throw new JWSSignatureVerificationFailed();
  }
  let payload;
  if (b64) {
    try {
      payload = decode(jws.payload);
    } catch {
      throw new JWSInvalid("Failed to base64url decode the payload");
    }
  } else if (typeof jws.payload === "string") {
    payload = encoder.encode(jws.payload);
  } else {
    payload = jws.payload;
  }
  const result = { payload };
  if (jws.protected !== void 0) {
    result.protectedHeader = parsedProt;
  }
  if (jws.header !== void 0) {
    result.unprotectedHeader = jws.header;
  }
  if (resolvedKey) {
    return { ...result, key };
  }
  return result;
}

// node_modules/jose/dist/node/esm/jws/compact/verify.js
async function compactVerify(jws, key, options) {
  if (jws instanceof Uint8Array) {
    jws = decoder.decode(jws);
  }
  if (typeof jws !== "string") {
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  }
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3) {
    throw new JWSInvalid("Invalid Compact JWS");
  }
  const verified = await flattenedVerify({ payload, protected: protectedHeader, signature }, key, options);
  const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}

// node_modules/jose/dist/node/esm/lib/epoch.js
var epoch_default = (date) => Math.floor(date.getTime() / 1e3);

// node_modules/jose/dist/node/esm/lib/secs.js
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
var secs_default = (str) => {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
};

// node_modules/jose/dist/node/esm/lib/jwt_claims_set.js
var normalizeTyp = (value) => value.toLowerCase().replace(/^application\//, "");
var checkAudiencePresence = (audPayload, audOption) => {
  if (typeof audPayload === "string") {
    return audOption.includes(audPayload);
  }
  if (Array.isArray(audPayload)) {
    return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
  }
  return false;
};
var jwt_claims_set_default = (protectedHeader, encodedPayload, options = {}) => {
  let payload;
  try {
    payload = JSON.parse(decoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload)) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  }
  const { typ } = options;
  if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
  }
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
  const presenceCheck = [...requiredClaims];
  if (maxTokenAge !== void 0)
    presenceCheck.push("iat");
  if (audience !== void 0)
    presenceCheck.push("aud");
  if (subject !== void 0)
    presenceCheck.push("sub");
  if (issuer !== void 0)
    presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse())) {
    if (!(claim in payload)) {
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
    }
  }
  if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
    throw new JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
  }
  if (subject && payload.sub !== subject) {
    throw new JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
  }
  if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
    throw new JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
  }
  let tolerance;
  switch (typeof options.clockTolerance) {
    case "string":
      tolerance = secs_default(options.clockTolerance);
      break;
    case "number":
      tolerance = options.clockTolerance;
      break;
    case "undefined":
      tolerance = 0;
      break;
    default:
      throw new TypeError("Invalid clockTolerance option type");
  }
  const { currentDate } = options;
  const now = epoch_default(currentDate || /* @__PURE__ */ new Date());
  if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
    throw new JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
  }
  if (payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number") {
      throw new JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
    }
    if (payload.nbf > now + tolerance) {
      throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
    }
  }
  if (payload.exp !== void 0) {
    if (typeof payload.exp !== "number") {
      throw new JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
    }
    if (payload.exp <= now - tolerance) {
      throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
    }
  }
  if (maxTokenAge) {
    const age = now - payload.iat;
    const max = typeof maxTokenAge === "number" ? maxTokenAge : secs_default(maxTokenAge);
    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
    }
    if (age < 0 - tolerance) {
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
    }
  }
  return payload;
};

// node_modules/jose/dist/node/esm/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const verified = await compactVerify(jwt, key, options);
  if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  }
  const payload = jwt_claims_set_default(verified.protectedHeader, verified.payload, options);
  const result = { payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}

// src/shared/jwt.mjs
var secretsClient = new SecretsManagerClient();
var cachedSecret = null;
async function getJwtSecret() {
  if (cachedSecret)
    return cachedSecret;
  const resp = await secretsClient.send(new GetSecretValueCommand({
    SecretId: process.env.JWT_SECRET_ARN
  }));
  let key = resp.SecretString;
  try {
    const parsed = JSON.parse(key);
    key = parsed.jwt_signing_key || parsed.secret || key;
  } catch (_) {
  }
  cachedSecret = new TextEncoder().encode(key);
  return cachedSecret;
}
async function verifyJwt(token) {
  try {
    const secret = await getJwtSecret();
    const { payload } = await jwtVerify(token, secret);
    return payload;
  } catch {
    return null;
  }
}

// src/shared/response.mjs
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Install-Id,X-Mandrain-Version",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Content-Type": "application/json"
};
function response(statusCode, body) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: JSON.stringify(body)
  };
}
function parseBody(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    return null;
  }
}

// src/analyze/index.mjs
var ddbClient = DynamoDBDocumentClient.from(new DynamoDBClient());
var bedrockClient = new BedrockRuntimeClient();
var WORD_CACHE_TABLE = process.env.WORD_CACHE_TABLE;
var MAX_TEXT_LENGTH = 30;
var CACHE_TTL_SECONDS = process.env.CACHE_TTL_SECONDS ? parseInt(process.env.CACHE_TTL_SECONDS) : 86400;
function buildCacheSortKey(lang, prefix, suffix) {
  const ctx = (prefix || "") + "|" + (suffix || "");
  if (ctx === "|")
    return lang;
  let h = 2166136261;
  for (let i = 0; i < ctx.length; i++) {
    h ^= ctx.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${lang}#${(h >>> 0).toString(16).padStart(8, "0")}`;
}
async function handler(event) {
  const httpMethod = event.httpMethod || event.requestContext?.http?.method || "";
  if (httpMethod === "OPTIONS") {
    return response(200, {});
  }
  const authHeader = event.headers?.Authorization || event.headers?.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return response(401, { error: "TOKEN_MISSING", message: "Authorization header is required" });
  }
  const jwtPayload = await verifyJwt(token);
  if (!jwtPayload) {
    return response(401, { error: "TOKEN_INVALID", message: "Invalid or expired access token" });
  }
  const body = parseBody(event);
  if (!body) {
    return response(400, { error: "INVALID_REQUEST", message: "Invalid JSON body" });
  }
  const { text, prefix, suffix, page_url, lang } = body;
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return response(400, { error: "EMPTY_TEXT", message: "text field is required" });
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return response(400, { error: "TEXT_TOO_LONG", message: `text exceeds ${MAX_TEXT_LENGTH} characters` });
  }
  const queryText = text.trim();
  const queryLang = lang || "zh";
  const cacheSortKey = buildCacheSortKey(queryLang, prefix, suffix);
  const cacheResult = await ddbClient.send(new GetCommand({
    TableName: WORD_CACHE_TABLE,
    Key: { text: queryText, lang: cacheSortKey }
  }));
  if (cacheResult.Item) {
    const cached = cacheResult.Item;
    return response(200, {
      zh: cached.zh,
      en: cached.en,
      definition: cached.definition,
      implication: cached.implication,
      sentiment: cached.sentiment,
      model: cached.model || "unknown",
      source: "cache"
    });
  }
  const userPlan = jwtPayload.plan || "free";
  if (userPlan === "free") {
    return response(403, {
      error: "UPGRADE_REQUIRED",
      message: "Subscribe to unlock full AI analysis for this term",
      text: queryText
    });
  }
  const prompt = buildPrompt(queryText, prefix, suffix, page_url);
  const aiResult = await invokeBedrockClaude(prompt);
  if (!aiResult) {
    return response(502, { error: "AI_SERVICE_ERROR", message: "Failed to get analysis from AI service" });
  }
  const ttl = Math.floor(Date.now() / 1e3) + CACHE_TTL_SECONDS;
  await ddbClient.send(new PutCommand({
    TableName: WORD_CACHE_TABLE,
    Item: {
      text: queryText,
      lang: cacheSortKey,
      zh: aiResult.zh || queryText,
      en: aiResult.en || "",
      definition: aiResult.definition || "",
      implication: aiResult.implication || "",
      sentiment: aiResult.sentiment || "neutral",
      model: aiResult._model || "unknown",
      source: "cloud",
      ttl
    }
  }));
  return response(200, {
    zh: aiResult.zh || queryText,
    en: aiResult.en || "",
    definition: aiResult.definition || "",
    implication: aiResult.implication || "",
    sentiment: aiResult.sentiment || "neutral",
    model: aiResult._model || "unknown",
    source: "cloud"
  });
}
var SYSTEM_PROMPT = '\u4F60\u662F\u4E2D\u6587\u8BED\u4E49\u5206\u6790\u4E13\u5BB6\uFF0C\u4E13\u6CE8\u4E8E\u7F51\u7EDC\u8BED\u8A00\u3001\u4FDA\u8BED\u548C\u6587\u5316\u5185\u6DB5\u5206\u6790\u3002\u4E25\u683C\u6309\u4EE5\u4E0BJSON\u683C\u5F0F\u8FD4\u56DE\uFF0C\u4E0D\u542B\u5176\u4ED6\u6587\u5B57\uFF0C\u6BCF\u4E2A\u5B57\u6BB5\u965050\u5B57\u4EE5\u5185\uFF1A{"zh":"\u539F\u8BCD","en":"\u6700\u8D34\u5207\u82F1\u6587\u7B49\u4EF7\u8BCD(\u7F51\u7EDC\u8BED\u7ED9\u4FDA\u8BED\u800C\u975E\u5B57\u9762\u76F4\u8BD1)","definition":"\u5B57\u9762\u542B\u4E49(\u82F1\u6587,\u7B80\u77ED)","implication":"\u5F53\u4EE3\u4E2D\u6587\u8BED\u5883\u771F\u5B9E\u542B\u4E49(\u82F1\u6587,\u7B80\u77ED)","sentiment":"positive\u6216negative\u6216neutral"}';
var DEEPSEEK_IDLE_TIMEOUT_MS = 15e3;
var DEEPSEEK_TOTAL_TIMEOUT_MS = 55e3;
var NOVA_PRO_MODEL_ID = "amazon.nova-pro-v1:0";
var DEEPSEEK_MODEL_ID = "deepseek.v3.2";
function buildPrompt(text, prefix, suffix, pageUrl) {
  let userMsg = `\u8BCD\u6C47: ${text}`;
  if (prefix)
    userMsg += `
\u524D\u6587: ${prefix}`;
  if (suffix)
    userMsg += `
\u540E\u6587: ${suffix}`;
  if (pageUrl)
    userMsg += `
\u6765\u6E90: ${pageUrl}`;
  return userMsg;
}
function parseJsonFromText(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch)
    return null;
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}
async function invokeDeepSeek(prompt) {
  const requestBody = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ],
    max_tokens: 256,
    temperature: 0.3
  };
  const command = new InvokeModelWithResponseStreamCommand({
    modelId: DEEPSEEK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody)
  });
  const resp = await bedrockClient.send(command);
  const stream = resp.body;
  let fullText = "";
  const result = await new Promise((resolve, reject) => {
    let idleTimer = null;
    const totalTimer = setTimeout(() => {
      clearTimeout(idleTimer);
      reject(new Error(`DeepSeek total timeout (${DEEPSEEK_TOTAL_TIMEOUT_MS}ms)`));
    }, DEEPSEEK_TOTAL_TIMEOUT_MS);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        clearTimeout(totalTimer);
        reject(new Error(`DeepSeek idle timeout (${DEEPSEEK_IDLE_TIMEOUT_MS}ms, no new chunk)`));
      }, DEEPSEEK_IDLE_TIMEOUT_MS);
    };
    resetIdleTimer();
    (async () => {
      try {
        for await (const event of stream) {
          resetIdleTimer();
          if (event.chunk?.bytes) {
            const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
            const delta = chunk.choices?.[0]?.delta?.content || "";
            fullText += delta;
          }
        }
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        resolve(fullText);
      } catch (err) {
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        reject(err);
      }
    })();
  });
  console.log("[DeepSeek-stream] raw response:", result);
  const parsed = parseJsonFromText(result);
  return parsed ? { ...parsed, _model: "deepseek.v3.2" } : null;
}
async function invokeNovaPro(prompt) {
  const fullPrompt = SYSTEM_PROMPT + "\n\n" + prompt;
  const requestBody = {
    messages: [{ role: "user", content: [{ text: fullPrompt }] }],
    inferenceConfig: { maxTokens: 256, temperature: 0.3 }
  };
  const command = new InvokeModelCommand({
    modelId: NOVA_PRO_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody)
  });
  const resp = await bedrockClient.send(command);
  const respBody = JSON.parse(new TextDecoder().decode(resp.body));
  const text = respBody.output?.message?.content?.[0]?.text || "";
  console.log("[NovaPro] raw response:", text);
  const parsed = parseJsonFromText(text);
  return parsed ? { ...parsed, _model: "amazon.nova-pro-v1:0" } : null;
}
async function invokeBedrockClaude(prompt) {
  try {
    const result = await invokeDeepSeek(prompt);
    if (result)
      return result;
  } catch (err) {
    console.warn("[Bedrock] DeepSeek failed or timed out, falling back to Nova Pro:", err.message);
  }
  try {
    return await invokeNovaPro(prompt);
  } catch (err) {
    console.error("[Bedrock] Nova Pro fallback also failed:", err);
    return null;
  }
}
var STREAM_HEADERS = {
  "Content-Type": "application/x-ndjson",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Install-Id,X-Mandrain-Version",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Cache-Control": "no-cache"
};
var streamHandler = awslambda.streamifyResponse(
  async (event, responseStream, _context) => {
    const httpMethod = event.requestContext?.http?.method || "";
    if (httpMethod === "OPTIONS") {
      responseStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: STREAM_HEADERS
      });
      responseStream.end();
      return;
    }
    responseStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 200,
      headers: STREAM_HEADERS
    });
    const write = (obj) => responseStream.write(JSON.stringify(obj) + "\n");
    try {
      const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (!token) {
        write({ type: "error", error: "TOKEN_MISSING", message: "Authorization header required" });
        responseStream.end();
        return;
      }
      const jwtPayload = await verifyJwt(token);
      if (!jwtPayload) {
        write({ type: "error", error: "TOKEN_INVALID", message: "Invalid or expired token" });
        responseStream.end();
        return;
      }
      let body;
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        body = null;
      }
      if (!body || !body.text || typeof body.text !== "string" || !body.text.trim()) {
        write({ type: "error", error: "EMPTY_TEXT", message: "text field is required" });
        responseStream.end();
        return;
      }
      if (body.text.length > MAX_TEXT_LENGTH) {
        write({ type: "error", error: "TEXT_TOO_LONG", message: `text exceeds ${MAX_TEXT_LENGTH} characters` });
        responseStream.end();
        return;
      }
      const queryText = body.text.trim();
      const queryLang = body.lang || "zh";
      const cacheSortKey = buildCacheSortKey(queryLang, body.prefix, body.suffix);
      write({ type: "status", stage: "received" });
      const cacheResult = await ddbClient.send(new GetCommand({
        TableName: WORD_CACHE_TABLE,
        Key: { text: queryText, lang: cacheSortKey }
      }));
      if (cacheResult.Item) {
        const cached = cacheResult.Item;
        write({
          type: "result",
          data: {
            zh: cached.zh,
            en: cached.en,
            definition: cached.definition,
            implication: cached.implication,
            sentiment: cached.sentiment,
            model: cached.model || "unknown",
            source: "cache"
          }
        });
        responseStream.end();
        return;
      }
      const userPlan = jwtPayload.plan || "free";
      if (userPlan === "free") {
        write({ type: "error", error: "UPGRADE_REQUIRED", message: "Subscribe to unlock full AI analysis", text: queryText });
        responseStream.end();
        return;
      }
      const prompt = buildPrompt(queryText, body.prefix, body.suffix, body.page_url);
      write({ type: "status", stage: "analyzing", model: DEEPSEEK_MODEL_ID });
      let aiResult = null;
      try {
        aiResult = await invokeDeepSeekWithProgress(prompt, write);
      } catch (err) {
        console.warn("[Stream] DeepSeek failed:", err.message);
        write({ type: "status", stage: "fallback", model: NOVA_PRO_MODEL_ID });
        try {
          aiResult = await invokeNovaPro(prompt);
        } catch (err2) {
          console.error("[Stream] Nova Pro also failed:", err2.message);
        }
      }
      if (!aiResult) {
        write({ type: "error", error: "AI_SERVICE_ERROR", message: "All models failed" });
        responseStream.end();
        return;
      }
      const ttl = Math.floor(Date.now() / 1e3) + CACHE_TTL_SECONDS;
      await ddbClient.send(new PutCommand({
        TableName: WORD_CACHE_TABLE,
        Item: {
          text: queryText,
          lang: cacheSortKey,
          zh: aiResult.zh || queryText,
          en: aiResult.en || "",
          definition: aiResult.definition || "",
          implication: aiResult.implication || "",
          sentiment: aiResult.sentiment || "neutral",
          model: aiResult._model || "unknown",
          source: "cloud",
          ttl
        }
      }));
      write({
        type: "result",
        data: {
          zh: aiResult.zh || queryText,
          en: aiResult.en || "",
          definition: aiResult.definition || "",
          implication: aiResult.implication || "",
          sentiment: aiResult.sentiment || "neutral",
          model: aiResult._model || "unknown",
          source: "cloud"
        }
      });
    } catch (err) {
      console.error("[Stream] Unhandled error:", err);
      write({ type: "error", error: "INTERNAL_ERROR", message: err.message });
    }
    responseStream.end();
  }
);
async function invokeDeepSeekWithProgress(prompt, write) {
  const requestBody = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ],
    max_tokens: 256,
    temperature: 0.3
  };
  const command = new InvokeModelWithResponseStreamCommand({
    modelId: DEEPSEEK_MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody)
  });
  const resp = await bedrockClient.send(command);
  const stream = resp.body;
  let fullText = "";
  let chunkCount = 0;
  const result = await new Promise((resolve, reject) => {
    let idleTimer = null;
    let heartbeatTimer = null;
    const totalTimer = setTimeout(() => {
      cleanup();
      reject(new Error(`DeepSeek total timeout (${DEEPSEEK_TOTAL_TIMEOUT_MS}ms)`));
    }, DEEPSEEK_TOTAL_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(idleTimer);
      clearTimeout(totalTimer);
      clearInterval(heartbeatTimer);
    };
    heartbeatTimer = setInterval(() => {
      write({ type: "status", stage: "thinking", chunks: chunkCount });
    }, 5e3);
    const resetIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        cleanup();
        reject(new Error(`DeepSeek idle timeout (${DEEPSEEK_IDLE_TIMEOUT_MS}ms)`));
      }, DEEPSEEK_IDLE_TIMEOUT_MS);
    };
    resetIdleTimer();
    (async () => {
      try {
        for await (const event of stream) {
          resetIdleTimer();
          if (event.chunk?.bytes) {
            const chunk = JSON.parse(new TextDecoder().decode(event.chunk.bytes));
            const delta = chunk.choices?.[0]?.delta?.content || "";
            fullText += delta;
            chunkCount++;
          }
        }
        cleanup();
        resolve(fullText);
      } catch (err) {
        cleanup();
        reject(err);
      }
    })();
  });
  console.log("[DeepSeek-stream-progress] raw response:", result);
  const parsed = parseJsonFromText(result);
  if (!parsed)
    throw new Error("DeepSeek returned unparseable response");
  return { ...parsed, _model: "deepseek.v3.2" };
}
export {
  handler,
  streamHandler
};
