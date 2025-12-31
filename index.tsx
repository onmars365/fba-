
import React, { useState, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';

// --- Types & Constants ---

type UnitSystem = 'metric' | 'imperial';

interface Dimensions {
  length: number;
  width: number;
  height: number;
  weight: number;
}

interface RequirementItem {
  label: string;
  target: string;
  isMet: boolean;
}

interface SavingOpportunity {
  type: 'DIMENSION' | 'WEIGHT';
  targetTier: string;
  savingAmount: number;
  currentFee: number;
  targetFee: number;
  requirements: RequirementItem[];
  currentStatus: string;
}

interface FeeResult {
  sizeTier: string;
  fulfillmentFee: number;
  dimensionalWeight: number;
  shippingWeight: number;
  details: string[];
  potentialSavings: SavingOpportunity[];
}

// --- Conversion Helpers ---
const CM_TO_IN = 0.393701;
const IN_TO_CM = 2.54;
const KG_TO_LB = 2.20462;
const LB_TO_KG = 0.453592;

const formatValue = (val: number) => (isNaN(val) ? "0.00" : val.toFixed(2));

// --- Calculation Logic ---

const calculateFBA = (dims: Dimensions, unit: UnitSystem, isClothing: boolean): FeeResult => {
  let { length, width, height, weight } = dims;

  // Convert to Imperial for internal calculation
  const lengthIn = unit === 'metric' ? length * CM_TO_IN : length;
  const widthIn = unit === 'metric' ? width * CM_TO_IN : width;
  const heightIn = unit === 'metric' ? height * CM_TO_IN : height;
  const weightLb = unit === 'metric' ? weight * KG_TO_LB : weight;

  const sortedDims = [lengthIn, widthIn, heightIn].sort((a, b) => b - a);
  const [L, W, H] = sortedDims;
  const dimWeight = (L * W * H) / 139;
  
  let sizeTier = "未知分段";
  const details: string[] = [];
  const potentialSavings: SavingOpportunity[] = [];

  const isSmallStandard = L <= 15 && W <= 12 && H <= 0.75 && weightLb <= 1;
  const isLargeStandard = L <= 18 && W <= 14 && H <= 8 && weightLb <= 20;

  const getFee = (w: number, isSmall: boolean, isLarge: boolean) => {
    if (isSmall) return isClothing ? 3.45 : 3.22;
    if (isLarge) {
      if (w <= 0.5) return 3.86;
      if (w <= 1) return 4.08;
      if (w <= 1.5) return 4.54;
      if (w <= 2) return 5.05;
      if (w <= 3) return 5.60;
      const extraHalfLbs = Math.ceil((Math.max(3, w) - 3) * 2);
      return 6.50 + (extraHalfLbs * 0.08) + (isClothing ? 1.00 : 0);
    }
    return 15.00 + (w * 0.50);
  };

  const currentShippingWeight = isSmallStandard ? weightLb : Math.max(weightLb, dimWeight);
  const currentFee = getFee(currentShippingWeight, isSmallStandard, isLargeStandard);

  const wtUnit = unit === 'metric' ? 'kg' : 'lb';
  const lenUnit = unit === 'metric' ? 'cm' : 'in';

  const currentTierName = isSmallStandard ? '小号标准' : isLargeStandard ? '大号标准' : '大件';
  const currentStatusStr = `${currentTierName}(${dims.length}*${dims.width}*${dims.height}${lenUnit}, ${dims.weight}${wtUnit})`;

  if (isSmallStandard) {
    sizeTier = "小号标准尺寸";
    details.push("符合最低计费分段。");
  } else if (isLargeStandard) {
    sizeTier = "大号标准尺寸";
    
    // Check for "Small Standard" potential
    if (L > 15 || W > 12 || H > 0.75 || weightLb > 1) {
      const ssFee = isClothing ? 3.45 : 3.22;
      const targetL = unit === 'metric' ? 38.1 : 15;
      const targetW = unit === 'metric' ? 30.5 : 12;
      const targetH = unit === 'metric' ? 1.9 : 0.75;
      const targetWt = unit === 'metric' ? 0.45 : 1;
      
      potentialSavings.push({
        type: 'DIMENSION',
        targetTier: "降级为小号标准",
        savingAmount: currentFee - ssFee,
        currentFee: currentFee,
        targetFee: ssFee,
        currentStatus: currentStatusStr,
        requirements: [
          { label: '最长边', target: `≤ ${targetL}${lenUnit}`, isMet: L <= 15 },
          { label: '中间边', target: `≤ ${targetW}${lenUnit}`, isMet: W <= 12 },
          { label: '最短边', target: `≤ ${targetH}${lenUnit}`, isMet: H <= 0.75 },
          { label: '实重', target: `≤ ${targetWt}${wtUnit}`, isMet: weightLb <= 1 }
        ]
      });
    }

    // Check for weight optimization
    const brackets = [0.5, 1, 1.5, 2, 3];
    const nextBracket = [...brackets].reverse().find(b => b < currentShippingWeight);
    if (nextBracket !== undefined) {
      const nextFee = getFee(nextBracket, false, true);
      const targetWtValue = unit === 'metric' ? nextBracket * LB_TO_KG : nextBracket;
      potentialSavings.push({
        type: 'WEIGHT',
        targetTier: "优化当前分段重量",
        savingAmount: currentFee - nextFee,
        currentFee: currentFee,
        targetFee: nextFee,
        currentStatus: `计费重 ${currentShippingWeight.toFixed(2)} lb`,
        requirements: [
          { label: '计费重', target: `< ${targetWtValue.toFixed(2)}${wtUnit}`, isMet: false }
        ]
      });
    }
    details.push(`计费重量: ${currentShippingWeight.toFixed(2)} lb (实重与体投取大值)`);
  } else {
    sizeTier = "大件尺寸 (Oversize)";
    const lsMaxWeightFee = getFee(20, false, true);
    const targetL = unit === 'metric' ? 45.7 : 18;
    const targetW = unit === 'metric' ? 35.6 : 14;
    const targetH = unit === 'metric' ? 20.3 : 8;
    const targetWt = unit === 'metric' ? 9.07 : 20;

    potentialSavings.push({
      type: 'DIMENSION',
      targetTier: "降级为大号标准",
      savingAmount: currentFee - lsMaxWeightFee,
      currentFee: currentFee,
      targetFee: lsMaxWeightFee,
      currentStatus: currentStatusStr,
      requirements: [
        { label: '最长边', target: `≤ ${targetL}${lenUnit}`, isMet: L <= 18 },
        { label: '中间边', target: `≤ ${targetW}${lenUnit}`, isMet: W <= 14 },
        { label: '最短边', target: `≤ ${targetH}${lenUnit}`, isMet: H <= 8 },
        { label: '重量', target: `≤ ${targetWt}${wtUnit}`, isMet: weightLb <= 20 }
      ]
    });
    details.push("当前超出标准件尺寸限制。");
  }

  return {
    sizeTier,
    fulfillmentFee: currentFee,
    dimensionalWeight: dimWeight,
    shippingWeight: currentShippingWeight,
    details,
    potentialSavings: potentialSavings.filter(s => s.savingAmount > 0.01)
  };
};

const Header = () => (
  <header className="amazon-bg-blue text-white p-4 md:p-5 shadow-sm sticky top-0 z-50">
    <div className="container mx-auto flex items-center justify-between">
      <div className="flex items-center gap-3 md:gap-4">
        <i className="fa-brands fa-amazon text-3xl md:text-4xl amazon-orange"></i>
        <h1 className="text-xl md:text-2xl font-bold tracking-tight">FBA 物流专家计算系统</h1>
      </div>
      <div className="hidden lg:block text-sm text-gray-400 font-bold uppercase tracking-widest">
        Global Logistics Expert
      </div>
    </div>
  </header>
);

const FBAReferenceTable = () => {
  return (
    <section className="card p-5 md:p-8 bg-white border border-gray-100 shadow-md mt-6 md:mt-10">
      <h3 className="text-base md:text-lg font-black text-gray-800 flex items-center gap-2 md:gap-3 uppercase tracking-widest mb-4 md:mb-8">
        <i className="fa-solid fa-table-list text-amazon-orange"></i> FBA 尺寸分段与费用对照参考
      </h3>
      <div className="overflow-x-auto border border-gray-100 rounded-xl">
        <table className="w-full text-left border-collapse bg-white min-w-[600px]">
          <thead>
            <tr className="bg-gray-50 text-xs uppercase font-black text-gray-500 tracking-tighter">
              <th className="p-4 border-b border-gray-100">分段名称</th>
              <th className="p-4 border-b border-gray-100">最长边</th>
              <th className="p-4 border-b border-gray-100">中间边</th>
              <th className="p-4 border-b border-gray-100">最短边</th>
              <th className="p-4 border-b border-gray-100">最大重量</th>
              <th className="p-4 border-b border-gray-100">起步费用 (非服装)</th>
            </tr>
          </thead>
          <tbody className="text-sm font-medium text-gray-700">
            <tr className="hover:bg-gray-50/50 border-b border-gray-50">
              <td className="p-4 font-bold text-amazon-blue">小号标准尺寸</td>
              <td className="p-4">≤ 38.1 cm / 15 in</td>
              <td className="p-4">≤ 30.5 cm / 12 in</td>
              <td className="p-4">≤ 1.9 cm / 0.75 in</td>
              <td className="p-4">≤ 0.45 kg / 1 lb</td>
              <td className="p-4 text-amazon-blue font-black">$3.22</td>
            </tr>
            <tr className="hover:bg-gray-50/50 border-b border-gray-50">
              <td className="p-4 font-bold text-amazon-blue">大号标准尺寸</td>
              <td className="p-4">≤ 45.7 cm / 18 in</td>
              <td className="p-4">≤ 35.6 cm / 14 in</td>
              <td className="p-4">≤ 20.3 cm / 8 in</td>
              <td className="p-4">≤ 9.07 kg / 20 lb</td>
              <td className="p-4 text-amazon-blue font-black">$3.86 - $7.00+</td>
            </tr>
            <tr className="hover:bg-gray-50/50">
              <td className="p-4 font-bold text-amazon-blue">大件 (Oversize)</td>
              <td className="p-4">> 45.7 cm / 18 in</td>
              <td className="p-4">> 35.6 cm / 14 in</td>
              <td className="p-4">> 20.3 cm / 8 in</td>
              <td className="p-4">> 9.07 kg / 20 lb</td>
              <td className="p-4 text-amazon-blue font-black">$15.00+</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
};

const App = () => {
  const [unit, setUnit] = useState<UnitSystem>('metric');
  const [dims, setDims] = useState<Dimensions>({ length: 20, width: 15, height: 5, weight: 0.5 });
  const [isClothing, setIsClothing] = useState(false);

  const result = useMemo(() => calculateFBA(dims, unit, isClothing), [dims, unit, isClothing]);

  const handleUnitChange = (newUnit: UnitSystem) => {
    if (newUnit === unit) return;

    setDims(prev => {
      const isToImperial = newUnit === 'imperial';
      return {
        length: parseFloat((isToImperial ? prev.length * CM_TO_IN : prev.length * IN_TO_CM).toFixed(2)),
        width: parseFloat((isToImperial ? prev.width * CM_TO_IN : prev.width * IN_TO_CM).toFixed(2)),
        height: parseFloat((isToImperial ? prev.height * CM_TO_IN : prev.height * IN_TO_CM).toFixed(2)),
        weight: parseFloat((isToImperial ? prev.weight * KG_TO_LB : prev.weight * LB_TO_KG).toFixed(3)),
      };
    });
    setUnit(newUnit);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setDims(prev => ({ ...prev, [name]: parseFloat(value) || 0 }));
  };

  const renderInputField = (label: string, name: keyof Dimensions) => {
    const isWeight = name === 'weight';
    const primaryUnit = unit === 'metric' ? (isWeight ? 'kg' : 'cm') : (isWeight ? 'lb' : 'in');
    const secondaryUnit = unit === 'metric' ? (isWeight ? 'lb' : 'in') : (isWeight ? 'kg' : 'cm');
    let convertedValue = unit === 'metric' ? (isWeight ? dims[name] * KG_TO_LB : dims[name] * CM_TO_IN) : (isWeight ? dims[name] * LB_TO_KG : dims[name] * IN_TO_CM);

    return (
      <div className="space-y-2">
        <label className="text-xs font-black text-gray-500 uppercase tracking-tight">
          {label}
        </label>
        <div className="relative group">
          <input 
            type="number" 
            name={name} 
            value={dims[name]} 
            onChange={handleInputChange}
            step="any"
            inputMode="decimal"
            className="w-full p-3 border-2 rounded-xl border-gray-100 bg-white transition-all text-lg font-bold text-amazon-blue shadow-sm focus:border-amazon-orange focus:outline-none"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-xs text-gray-400 font-mono font-bold uppercase">
            {primaryUnit}
          </div>
        </div>
        <div className="text-xs text-gray-500 font-medium italic">
          ≈ {formatValue(convertedValue)} {secondaryUnit}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen pb-10 bg-[#f8f9fa]">
      <Header />
      
      <main className="container mx-auto mt-6 md:mt-10 px-4 md:px-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Column 1: Inputs */}
          <div className="lg:col-span-3 space-y-6 lg:sticky lg:top-24">
            <section className="card p-5 md:p-6 border border-gray-100 shadow-md bg-white">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-base font-black amazon-blue">产品录入</h2>
                <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                  <button 
                    onClick={() => handleUnitChange('metric')} 
                    className={`px-3 py-1 text-xs rounded-md transition-all ${unit === 'metric' ? 'bg-white shadow-sm text-amazon-blue font-bold' : 'text-gray-500'}`}
                  >公制</button>
                  <button 
                    onClick={() => handleUnitChange('imperial')} 
                    className={`px-3 py-1 text-xs rounded-md transition-all ${unit === 'imperial' ? 'bg-white shadow-sm text-amazon-blue font-bold' : 'text-gray-500'}`}
                  >英制</button>
                </div>
              </div>

              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-5">
                  <div className="grid grid-cols-3 gap-3">
                    {renderInputField('长', 'length')}
                    {renderInputField('宽', 'width')}
                    {renderInputField('高', 'height')}
                  </div>
                  {renderInputField('毛重', 'weight')}
                </div>
              </div>

              <div className="mt-6 pt-6 border-t border-dashed border-gray-200">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" checked={isClothing} onChange={(e) => setIsClothing(e.target.checked)} className="sr-only"/>
                    <div className={`w-10 h-6 rounded-full transition-colors ${isClothing ? 'amazon-bg-orange' : 'bg-gray-300'}`}></div>
                    <div className={`absolute left-0.5 top-0.5 bg-white w-5 h-5 rounded-full shadow transition-transform duration-200 ${isClothing ? 'translate-x-4' : ''}`}></div>
                  </div>
                  <span className="text-sm font-bold text-gray-700 group-hover:text-amazon-blue">服装 / 鞋靴</span>
                </label>
              </div>
            </section>
          </div>

          {/* Column 2: Suggestions */}
          <div className="lg:col-span-9 space-y-6">
            <section className="card p-5 md:p-8 bg-white border border-gray-100 shadow-md">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-8">
                 <h3 className="text-base md:text-lg font-black text-gray-800 flex items-center gap-2 uppercase tracking-widest">
                  <i className="fa-solid fa-wand-magic-sparkles text-amazon-orange text-xl"></i> 降本建议
                </h3>
                <div className="flex justify-between sm:text-right items-center gap-6 bg-gray-50 sm:bg-transparent p-4 sm:p-0 rounded-2xl sm:rounded-none">
                   <div className="flex flex-col sm:items-end">
                     <span className="text-xs text-gray-500 font-black uppercase tracking-tight">当前费用</span>
                     <span className="text-2xl font-black text-amazon-blue">${result.fulfillmentFee.toFixed(2)}</span>
                   </div>
                   <div className="w-px h-8 bg-gray-200 hidden sm:block"></div>
                   <div className="flex flex-col sm:items-end">
                     <span className="text-xs text-gray-500 font-black uppercase tracking-tight">计费重</span>
                     <span className="text-2xl font-black text-amazon-blue">{result.shippingWeight.toFixed(2)} lb</span>
                   </div>
                </div>
              </div>
              
              {result.potentialSavings.length > 0 ? (
                <div className="overflow-x-auto border border-gray-100 rounded-xl -mx-4 sm:mx-0">
                  <table className="w-full text-left border-collapse bg-white min-w-[550px]">
                    <thead>
                      <tr className="bg-gray-50 text-xs uppercase font-black text-gray-500 tracking-tighter">
                        <th className="p-4 border-b border-gray-100 w-[22%]">优化方案</th>
                        <th className="p-4 border-b border-gray-100 w-[30%]">当前状态</th>
                        <th className="p-4 border-b border-gray-100">改进目标</th>
                        <th className="p-4 border-b border-gray-100 text-right w-[15%]">预估节省</th>
                      </tr>
                    </thead>
                    <tbody className="text-sm">
                      {result.potentialSavings.map((save, i) => (
                        <tr key={i} className="hover:bg-gray-50/50 transition-colors border-b last:border-none border-gray-50">
                          <td className="p-4 align-top">
                            <div className="flex flex-col gap-2">
                              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black text-center w-fit uppercase ${save.type === 'DIMENSION' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                                {save.type === 'DIMENSION' ? '尺寸优化' : '重量优化'}
                              </span>
                              <span className="text-sm font-black text-gray-900 leading-snug">{save.targetTier}</span>
                            </div>
                          </td>
                          <td className="p-4 align-top">
                             <div className="flex flex-col gap-2 bg-gray-50/50 p-3 rounded-xl border border-gray-100">
                               <div className="text-xs text-gray-600 font-medium leading-relaxed">
                                 {save.currentStatus}
                               </div>
                               <div className="text-sm font-black text-gray-800">
                                 费用: ${save.currentFee.toFixed(2)}
                               </div>
                             </div>
                          </td>
                          <td className="p-4 align-top">
                            <div className="flex flex-col gap-3 bg-green-50/30 p-3 rounded-xl border border-green-100/50">
                              <div className="flex flex-wrap gap-x-4 gap-y-2">
                                {save.requirements.map((req, j) => (
                                  <div key={j} className="flex flex-col">
                                    <span className="text-[10px] text-gray-400 uppercase font-black tracking-tight">{req.label}</span>
                                    <span className={`text-xs font-black ${req.isMet ? 'text-green-600' : 'text-red-500 underline decoration-red-200 underline-offset-4 font-bold'}`}>
                                      {req.target}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div className="text-xs font-black text-green-700 pt-2 border-t border-green-100/50">
                                目标费用: <span className="text-sm">${save.targetFee.toFixed(2)}</span>
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-right align-top">
                            <div className="text-sm font-black text-green-600 bg-green-50 px-3 py-1.5 rounded-lg inline-block whitespace-nowrap">
                              -${save.savingAmount.toFixed(2)}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-center py-12 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                  <p className="text-sm text-gray-500 font-bold uppercase tracking-widest">已处于该分类下的最优阶梯</p>
                </div>
              )}
            </section>
          </div>

        </div>

        <FBAReferenceTable />
      </main>

      <footer className="mt-10 text-center text-gray-500 text-xs py-10 border-t border-gray-200 uppercase tracking-widest font-bold px-6">
        <p>© 2024 FBA Logistics Expert Intelligence System</p>
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
