/* Concept layout only: assumptions are not an installation or safety specification. */
const LandingPlanner = (() => {
  const profiles = [
    {name:'뷰티매장',wall:'경량랙',island:'경량랙',bay:1.2,depth:.45,islandDepth:.9,aisle:1.2},
    {name:'약국',wall:'경량랙',island:'곤도라 진열대',bay:1.2,depth:.45,islandDepth:.9,aisle:1.2},
    {name:'문구·팬시점',wall:'하이퍼 진열대',island:'하이퍼 진열대',bay:1.0,depth:.45,islandDepth:.9,aisle:1.2},
    {name:'마트·편의점',wall:'하이퍼 진열대',island:'하이퍼 진열대',bay:1.2,depth:.5,islandDepth:1,aisle:1.4},
    {name:'의류 매장',wall:'경량랙',island:'경량랙',bay:1.2,depth:.45,islandDepth:.9,aisle:1.4},
    {name:'낚시 매장',wall:'곤도라 진열대',island:'하이퍼 진열대',bay:1.2,depth:.5,islandDepth:1,aisle:1.4},
    {name:'물류·공장 창고',wall:'파렛트랙',island:'파렛트랙',bay:2.7,depth:1.1,islandDepth:1.1,aisle:3.2},
    {name:'사무실·비품실',wall:'무볼트 앵글',island:'경량랙',bay:1.2,depth:.45,islandDepth:.6,aisle:1.2},
    {name:'식자재 창고',wall:'중량랙',island:'중량랙',bay:1.2,depth:.6,islandDepth:.6,aisle:1.4},
    {name:'연구소·부품실',wall:'중량랙',island:'중량랙',bay:1.2,depth:.6,islandDepth:.6,aisle:1.4},
    {name:'문화센터·교육시설',wall:'무볼트 앵글',island:'무볼트 앵글',bay:1.2,depth:.45,islandDepth:.6,aisle:1.4},
    {name:'신발·의류 재고실',wall:'경량랙',island:'경량랙',bay:1.2,depth:.45,islandDepth:.6,aisle:1.2}
  ];
  const overlap = (a,b) => a.x < b.x+b.w-1e-8 && a.x+a.w > b.x+1e-8 && a.y < b.y+b.h-1e-8 && a.y+a.h > b.y+1e-8;
  function createLayout(value,profileIndex=0) {
    const py=Math.max(5,Math.min(200,Math.round(Number(value)||5)));
    const p=profiles[profileIndex]||profiles[0], area=py*3.3058;
    const width=Math.sqrt(area*1.35), height=area/width, margin=.15;
    const front=Math.max(1.4,p.aisle), center=width/2;
    const aisles=[{x:center-p.aisle/2,y:0,w:p.aisle,h:height},
      {x:0,y:height-front,w:width,h:front}];
    if(height>10) aisles.push({x:0,y:height/2-p.aisle/2,w:width,h:p.aisle});
    const racks=[];
    function add(x,y,w,h,kind) {
      const item={x,y,w,h,kind,type:kind==='wall'?p.wall:p.island};
      if(x<margin-1e-8||y<margin-1e-8||x+w>width-margin+1e-8||y+h>height-front+1e-8) return;
      if(aisles.some(a=>overlap(item,a))||racks.some(a=>overlap(item,a))) return;
      racks.push(item);
    }
    // Wall bays stop at the main aisle. Side bays start after a rear access gap.
    for(let x=margin;x+p.bay<=width-margin;x+=p.bay+.08) add(x,margin,p.bay,p.depth,'wall');
    for(let y=margin+p.depth+p.aisle;y+p.bay<=height-front;y+=p.bay+.08) {
      add(margin,y,p.depth,p.bay,'wall');
      add(width-margin-p.depth,y,p.depth,p.bay,'wall');
    }
    // Parallel islands in each half; a walking aisle separates every column.
    const halves=[[margin+p.depth+p.aisle,center-p.aisle/2],
      [center+p.aisle/2,width-margin-p.depth-p.aisle]];
    for(const [left,right] of halves) {
      for(let x=left;x+p.islandDepth<=right;x+=p.islandDepth+p.aisle) {
        for(let y=margin+p.depth+p.aisle;y+p.bay<=height-front;y+=p.bay+.08) add(x,y,p.islandDepth,p.bay,'island');
      }
    }
    const counts=['wall','island'].map(kind=>({kind,type:kind==='wall'?p.wall:p.island,count:racks.filter(r=>r.kind===kind).length}));
    return {py,width,height,profile:p,aisles,racks,counts,total:racks.length};
  }
  return {profiles,createLayout,overlap};
})();
