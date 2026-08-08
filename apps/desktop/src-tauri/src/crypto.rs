//! X25519 pairing keys and XChaCha20-Poly1305 payload sealing.
//!
//! The desktop's secret key is generated once and persisted, so a phone that
//! paired yesterday still recognises this PC today.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chacha20poly1305::{
    aead::{Aead, KeyInit},
    XChaCha20Poly1305, XNonce,
};
use hkdf::Hkdf;
use rand::RngCore;
use sha2::{Digest, Sha256};
use x25519_dalek::{PublicKey, StaticSecret};

const NONCE_LEN: usize = 24;
const KDF_INFO: &[u8] = b"cliplink-v1-session";

pub struct Identity {
    secret: StaticSecret,
}

impl Identity {
    pub fn generate() -> Self {
        Identity {
            secret: StaticSecret::random_from_rng(rand::thread_rng()),
        }
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Identity {
            secret: StaticSecret::from(bytes),
        }
    }

    pub fn to_bytes(&self) -> [u8; 32] {
        self.secret.to_bytes()
    }

    pub fn public_key_b64(&self) -> String {
        B64.encode(PublicKey::from(&self.secret).as_bytes())
    }

    /// Derives the symmetric key shared with `peer_public_b64`.
    ///
    /// The raw Diffie-Hellman output is run through HKDF rather than used
    /// directly: X25519 shared secrets are not uniformly distributed, and
    /// feeding one straight into a cipher key is a well-known footgun.
    pub fn session_key(&self, peer_public_b64: &str) -> Result<SessionKey, CryptoError> {
        let raw = B64
            .decode(peer_public_b64)
            .map_err(|_| CryptoError::BadPublicKey)?;
        let bytes: [u8; 32] = raw.try_into().map_err(|_| CryptoError::BadPublicKey)?;
        let shared = self.secret.diffie_hellman(&PublicKey::from(bytes));

        let hkdf = Hkdf::<Sha256>::new(None, shared.as_bytes());
        let mut key = [0u8; 32];
        hkdf.expand(KDF_INFO, &mut key)
            .map_err(|_| CryptoError::KeyDerivation)?;
        Ok(SessionKey(key))
    }
}

#[derive(Clone)]
pub struct SessionKey([u8; 32]);

impl SessionKey {
    pub fn seal(&self, plaintext: &[u8]) -> Result<String, CryptoError> {
        let cipher = XChaCha20Poly1305::new(self.0.as_ref().into());

        let mut nonce = [0u8; NONCE_LEN];
        rand::thread_rng().fill_bytes(&mut nonce);

        let ciphertext = cipher
            .encrypt(XNonce::from_slice(&nonce), plaintext)
            .map_err(|_| CryptoError::Encrypt)?;

        // Nonce travels with the ciphertext; it is not secret, only single-use.
        let mut framed = nonce.to_vec();
        framed.extend_from_slice(&ciphertext);
        Ok(B64.encode(framed))
    }

    pub fn open(&self, sealed_b64: &str) -> Result<Vec<u8>, CryptoError> {
        let framed = B64.decode(sealed_b64).map_err(|_| CryptoError::Decrypt)?;
        if framed.len() <= NONCE_LEN {
            return Err(CryptoError::Decrypt);
        }

        let (nonce, ciphertext) = framed.split_at(NONCE_LEN);
        XChaCha20Poly1305::new(self.0.as_ref().into())
            .decrypt(XNonce::from_slice(nonce), ciphertext)
            .map_err(|_| CryptoError::Decrypt)
    }
}

pub fn hash_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

#[derive(Debug)]
pub enum CryptoError {
    BadPublicKey,
    KeyDerivation,
    Encrypt,
    Decrypt,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn both_sides_derive_the_same_key() {
        let pc = Identity::generate();
        let phone = Identity::generate();

        let from_pc = pc.session_key(&phone.public_key_b64()).unwrap();
        let from_phone = phone.session_key(&pc.public_key_b64()).unwrap();

        let sealed = from_pc.seal(b"hello from the PC").unwrap();
        assert_eq!(from_phone.open(&sealed).unwrap(), b"hello from the PC");
    }

    #[test]
    fn an_unrelated_key_cannot_open_the_payload() {
        let pc = Identity::generate();
        let phone = Identity::generate();
        let stranger = Identity::generate();

        let sealed = pc
            .session_key(&phone.public_key_b64())
            .unwrap()
            .seal(b"secret")
            .unwrap();
        let wrong = pc.session_key(&stranger.public_key_b64()).unwrap();

        assert!(wrong.open(&sealed).is_err());
    }

    #[test]
    fn identity_survives_a_round_trip_through_bytes() {
        let original = Identity::generate();
        let restored = Identity::from_bytes(original.to_bytes());
        assert_eq!(original.public_key_b64(), restored.public_key_b64());
    }
}
