/** 기존 카탈로그의 2축/3축 규격을 보존하면서 화면에서는 W/D/H로 취급한다. */
const RackSpec = (() => {
  const depthFirst = type => ['고급경량랙', 'MD경량랙', 'MD중량랙', 'KD중량랙'].includes(type);
  function parse(row) {
    const nums = String(row.spec || '').split(/[*xX×]/).map(s => s.trim());
    const tier = String(row.tier || '').match(/^(\d+)\s*\((\d+)단\)/);
    const legacy = nums.length === 2;
    const reverse = depthFirst(row.type) || legacy;
    return { width: nums[reverse ? 1 : 0] || '', depth: nums[reverse ? 0 : 1] || '',
      height: legacy && tier ? tier[1] : nums[2] || '', tier: tier ? tier[2] : row.tier || '', legacy };
  }
  function serialize(type, width, depth, height, tier, legacy) {
    const axes = depthFirst(type) || legacy ? [depth, width] : [width, depth];
    if (!legacy) axes.push(height);
    return { spec: axes.filter(Boolean).join('*'), tier: legacy && height ? `${height}(${tier}단)` : Number(tier) || 0 };
  }
  return { parse, serialize };
})();
