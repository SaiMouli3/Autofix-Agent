// Package auth handles password hashing and signed session tokens.
package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const CookieName = "eaos_session"

type Claims struct {
	OrgID string `json:"org"`
	jwt.RegisteredClaims
}

type Manager struct {
	secret []byte
}

func NewManager(secret string) *Manager { return &Manager{secret: []byte(secret)} }

func HashPassword(pw string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	return string(b), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

func (m *Manager) Issue(userID, orgID string, ttl time.Duration) (string, error) {
	now := time.Now()
	c := Claims{OrgID: orgID, RegisteredClaims: jwt.RegisteredClaims{
		Subject: userID, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(ttl)), Issuer: "eaos",
	}}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, c).SignedString(m.secret)
}

func (m *Manager) Parse(token string) (*Claims, error) {
	var c Claims
	t, err := jwt.ParseWithClaims(token, &c, func(t *jwt.Token) (any, error) {
		if t.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return m.secret, nil
	}, jwt.WithIssuer("eaos"), jwt.WithExpirationRequired())
	if err != nil || !t.Valid {
		return nil, errors.New("invalid session")
	}
	return &c, nil
}
