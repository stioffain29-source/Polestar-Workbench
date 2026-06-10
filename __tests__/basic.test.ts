describe('Basic Test Framework', () => {
  it('should pass a simple test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle TypeScript', () => {
    const message: string = 'Test framework is working';
    expect(message).toContain('working');
  });
});
