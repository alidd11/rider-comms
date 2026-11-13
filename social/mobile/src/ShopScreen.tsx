import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import { demoListings } from './sampleData';

type Item = (typeof demoListings)[number];
type Page = 'discover' | 'saved' | 'basket' | 'orders';
const categories = ['All', 'Accessories', 'Vehicles', 'Rentals'] as const;
const interests = ['All', 'Cars', 'Motorcycles', 'Cycling'] as const;

export function ShopScreen({ items, collectionItems, search, onSearch, category, onCategory,
  saved, basket, onToggleSaved, onAddBasket, onExploreClubs }: {
  items: readonly Item[];
  collectionItems: readonly Item[];
  search: string;
  onSearch: (value:string) => void;
  category: string;
  onCategory: (value:string) => void;
  // Session-local preview selections live above the screen so tab navigation
  // cannot silently discard them. Nothing is persisted or purchased.
  saved: ReadonlySet<string>;
  basket: ReadonlySet<string>;
  onToggleSaved: (id: string) => void;
  onAddBasket: (id: string) => void;
  onExploreClubs: () => void;
}) {
  const [section,setSection] = useState<Page>('discover');
  const [interest,setInterest] = useState<string>('All');
  const [filtersOpen,setFiltersOpen] = useState(false);
  const [selected,setSelected] = useState<string|null>(null);
  const [shop,setShop] = useState<string|null>(null);
  const [message,setMessage] = useState<string|null>(null);
  const item = selected ? collectionItems.find(x => x.id === selected) : null;
  const filtered = useMemo(() => (section === 'discover' ? items : collectionItems).filter(x =>
    (section !== 'discover' || interest === 'All' || x.topic === interest) &&
    (section !== 'saved' || saved.has(x.id)) &&
    (section !== 'basket' || basket.has(x.id)) &&
    (!shop || x.merchant === shop)
  ),[items,collectionItems,interest,section,saved,basket,shop]);

  function openProduct(product:Item) { setSelected(product.id);setMessage(null); }
  function addProduct(product:Item) {
    if (product.type !== 'Product') {
      setMessage('Enquiries and rental bookings require verified businesses. This is only a preview.');
      return;
    }
    onAddBasket(product.id);
    setMessage('Added to your preview basket. No payment or order was created.');
  }
  function browse() { setSelected(null);setShop(null);setSection('discover');setMessage(null); }
  const hasDiscoveryFilters = Boolean(search.trim() || category !== 'All' || interest !== 'All' || shop);
  const noLiveInventory = collectionItems.length === 0;
  function resetDiscovery() {
    onSearch('');
    onCategory('All');
    setInterest('All');
    setShop(null);
    setSection('discover');
    setFiltersOpen(false);
  }
  const filterButton = (label:string,active:boolean,onPress:()=>void,prefix:string) =>
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={prefix+label}
      accessibilityState={{selected:active}} onPress={onPress}
      style={{borderRadius:999,minHeight:40,paddingVertical:9,paddingHorizontal:16,
        justifyContent:'center',borderWidth:1,
        borderColor:active?C.accent:C.border,backgroundColor:active?C.accentDark:C.panel}}>
      <Text style={{color:active?C.accent:C.ink,fontSize:13,fontWeight:'700'}}>{label}</Text>
    </Pressable>;

  if (item) return <View testID="shop-product-details" style={{gap:15,paddingBottom:24}}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back to Shop" onPress={()=>setSelected(null)}
      style={{paddingHorizontal:16,minHeight:44,flexDirection:'row',alignItems:'center',gap:9}}>
      <Ionicons name="arrow-back" color={C.ink} size={22}/>
      <Text style={{color:C.ink,fontWeight:'800'}}>Shop</Text>
    </Pressable>
    <View style={{aspectRatio:1,maxHeight:560,backgroundColor:item.accent}}>
      <Image source={{uri:item.imageUrl}} accessibilityLabel={item.imageAlt}
        resizeMode="cover" style={{width:'100%',height:'100%'}}/>
      <View style={{position:'absolute',top:12,left:12,backgroundColor:'rgba(0,0,0,0.76)',
        paddingVertical:6,paddingHorizontal:9,borderRadius:8}}>
        <Text style={{color:'#FFFFFF',fontSize:11,fontWeight:'900'}}>SAMPLE PRODUCT</Text>
      </View>
    </View>
    <View style={{paddingHorizontal:16,gap:13}}>
      <Text style={{color:C.ink,fontSize:22,fontWeight:'900'}}>{item.name}</Text>
      <Text style={{color:C.ink,fontSize:24,fontWeight:'900'}}>{item.price}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={'Visit store '+item.merchant}
        onPress={()=>{setShop(item.merchant);setSection('discover');setSelected(null);}}
        style={{borderTopWidth:1,borderBottomWidth:1,borderColor:C.border,
          minHeight:62,flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
        <View style={{gap:4}}>
          <Text style={{color:C.ink,fontWeight:'800',fontSize:14}}>{item.merchant}</Text>
          <Text style={{color:C.muted,fontSize:11}}>Example storefront · not an approved merchant</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={C.muted}/>
      </Pressable>
      <Text style={{color:C.muted,fontSize:13,lineHeight:19}}>
        Illustrative listing only. Stock, delivery, reviews, seller credentials and pricing are not verified.
      </Text>
      {message?<Text accessibilityRole="alert" style={{color:C.accent,fontSize:12}}>{message}</Text>:null}
      <View style={{flexDirection:'row',gap:10}}>
        <Pressable accessibilityRole="button" accessibilityLabel={(saved.has(item.id)?'Unsave ':'Save ')+item.name}
          onPress={()=>onToggleSaved(item.id)} style={[s.ghost,{justifyContent:'center',minWidth:54}]}>
          <Ionicons name={saved.has(item.id)?'heart':'heart-outline'} size={21} color={C.accent}/>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={'Add to preview basket '+item.name}
          onPress={()=>addProduct(item)} style={[s.cta,{flex:1,alignItems:'center'}]}>
          <Text style={s.ctaText}>{item.type==='Product'?'Add to basket':'Enquire (preview)'}</Text>
        </Pressable>
      </View>
      <Text style={{color:C.muted,fontSize:11}}>No live checkout or booking is available.</Text>
    </View>
  </View>;

  const sectionTitle = section === 'saved' ? 'Saved items' :
    section === 'basket' ? 'Your basket' :
    section === 'orders' ? 'Your orders' :
    shop ? shop : 'Discover';

  const emptyTitle = section === 'saved' ? 'No saved items yet' :
    section === 'basket' ? 'Your basket is empty' :
    section === 'orders' ? 'No orders yet' :
    noLiveInventory ? 'The marketplace is getting ready' :
    hasDiscoveryFilters ? 'No matching listings' : 'No listings available';

  const emptyDescription = section === 'saved'
    ? 'Products you save will appear here during this preview session.'
    : section === 'basket'
      ? 'Your preview basket will show products you choose. No payment is taken.'
      : section === 'orders'
        ? 'Orders and checkout will appear after verified businesses and payments are enabled.'
        : noLiveInventory
          ? 'We’re preparing a marketplace for approved businesses. Products, rentals and checkout are not live yet.'
          : hasDiscoveryFilters
            ? 'Try a different search, category or vehicle type.'
            : 'There are no listings in this collection yet.';

  const emptyIcon = section === 'saved' ? 'heart-outline' :
    section === 'basket' ? 'bag-handle-outline' :
    section === 'orders' ? 'receipt-outline' :
    noLiveInventory ? 'storefront-outline' : 'search-outline';

  return <View testID="shop-discovery" style={{
    width:'100%',maxWidth:850,alignSelf:'center',paddingBottom:28,
  }}>
    <View style={{paddingHorizontal:18,paddingTop:10,gap:14}}>
      <Text style={{color:C.muted,fontSize:13,lineHeight:18}}>
        Gear, vehicles & rentals
      </Text>
      <View style={{backgroundColor:C.panel,borderColor:C.border,borderWidth:1,borderRadius:16,
        flexDirection:'row',alignItems:'center',paddingLeft:15,minHeight:52,gap:11}}>
        <Ionicons name="search-outline" size={21} color={C.muted}/>
        <TextInput accessibilityLabel="Search marketplace" value={search}
          onChangeText={onSearch} placeholder="Search products and shops"
          placeholderTextColor={C.muted} returnKeyType="search"
          style={{flex:1,color:C.ink,fontSize:16,minHeight:50,paddingVertical:8}}/>
        {search.length>0?<Pressable accessibilityRole="button" accessibilityLabel="Clear Shop search"
          onPress={()=>onSearch('')} style={{width:44,height:48,alignItems:'center',justifyContent:'center'}}>
          <Ionicons name="close-circle" size={22} color={C.muted}/>
        </Pressable>:null}
      </View>
      <View style={{flexDirection:'row',alignItems:'center',gap:9}}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex:1}}
          contentContainerStyle={{gap:8,paddingVertical:1}}>
          {categories.map(x=>filterButton(x,category===x,
            ()=>{onCategory(x);setSection('discover');},'Shop category '))}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel="Shop filters"
          accessibilityState={{expanded:filtersOpen}}
          onPress={()=>setFiltersOpen(v=>!v)}
          style={{height:42,minWidth:44,paddingHorizontal:12,borderRadius:14,
            borderWidth:1,borderColor:filtersOpen||interest!=='All'?C.accent:C.border,
            backgroundColor:filtersOpen||interest!=='All'?C.accentDark:C.panel,
            flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7}}>
          <Ionicons name="options-outline" size={19}
            color={filtersOpen||interest!=='All'?C.accent:C.ink}/>
          <Text style={{fontSize:13,fontWeight:'700',
            color:filtersOpen||interest!=='All'?C.accent:C.ink}}>Filter</Text>
        </Pressable>
      </View>
      {filtersOpen?<View testID="shop-vehicle-filters" style={{
        backgroundColor:C.panel,borderColor:C.border,borderWidth:1,
        borderRadius:16,padding:14,gap:11}}>
        <Text style={{color:C.ink,fontSize:14,fontWeight:'700'}}>Vehicle type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          contentContainerStyle={{gap:8}}>
          {interests.map(x=>filterButton(x,interest===x,
            ()=>{setInterest(x);setFiltersOpen(false);},'Shop interest '))}
        </ScrollView>
        {interest!=='All'?<Pressable accessibilityRole="button" accessibilityLabel="Clear Shop vehicle filter"
          onPress={()=>{setInterest('All');setFiltersOpen(false);}}
          style={{minHeight:44,alignSelf:'flex-start',justifyContent:'center'}}>
          <Text style={{color:C.accent,fontSize:13,fontWeight:'700'}}>Clear vehicle filter</Text>
        </Pressable>:null}
      </View>:null}
      <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
        <Ionicons name="shield-checkmark-outline" size={17} color={C.accent}/>
        <Text style={{fontSize:12,color:C.muted,lineHeight:18}}>
          Verified businesses only · {noLiveInventory?'No live listings': 'Sample listings for testing'}
        </Text>
      </View>
    </View>

    <View style={{paddingHorizontal:18,marginTop:19,
      borderBottomColor:C.border,borderBottomWidth:1,flexDirection:'row'}}>
      {(['discover','saved','basket','orders'] as const).map(x=>{
        const label=x==='discover'?'Discover':x==='saved'?'Saved':x==='basket'?'Basket':'Orders';
        const active=section===x;
        return <Pressable key={x} accessibilityRole="button"
          accessibilityLabel={'Shop section '+label} accessibilityState={{selected:active}}
          onPress={()=>{setSection(x);setShop(null);setSelected(null);}}
          style={{flex:1,minHeight:48,alignItems:'center',justifyContent:'center',
            borderBottomWidth:2,borderBottomColor:active?C.accent:'transparent'}}>
          <Text style={{fontSize:14,fontWeight:active?'800':'600',
            color:active?C.ink:C.muted}}>{label}</Text>
        </Pressable>;
      })}
    </View>

    {shop?<View style={{paddingHorizontal:18,paddingTop:17,gap:8}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Shop" onPress={browse}
        style={{flexDirection:'row',alignItems:'center',gap:6,minHeight:44,alignSelf:'flex-start'}}>
        <Ionicons name="arrow-back" size={18} color={C.accent}/>
        <Text style={{color:C.accent,fontWeight:'700',fontSize:14}}>All shops</Text>
      </Pressable>
      <Text style={{color:C.ink,fontWeight:'800',fontSize:21}}>{shop}</Text>
      <Text style={{color:C.muted,fontSize:13}}>Sample storefront · Approval not connected</Text>
    </View>:null}

    {section==='discover' && noLiveInventory ? <View testID="shop-launch-state"
      style={{marginHorizontal:18,marginTop:22,borderRadius:23,
        backgroundColor:C.panel,borderWidth:1,borderColor:C.border,
        paddingHorizontal:22,paddingTop:26,paddingBottom:24,gap:13}}>
      <View style={{height:56,width:56,borderRadius:18,backgroundColor:C.accentDark,
        alignItems:'center',justifyContent:'center'}}>
        <Ionicons name="storefront-outline" size={27} color={C.accent}/>
      </View>
      <Text style={{color:C.accent,fontWeight:'800',fontSize:11,letterSpacing:1.2}}>
        MARKETPLACE PREVIEW
      </Text>
      <Text style={{color:C.ink,fontWeight:'800',fontSize:23,lineHeight:29,
        letterSpacing:-0.55}}>The marketplace is getting ready</Text>
      <Text style={{color:C.muted,fontSize:14,lineHeight:21}}>
        {emptyDescription}
      </Text>
      {hasDiscoveryFilters?<Pressable accessibilityRole="button" accessibilityLabel="Clear all Shop filters"
        onPress={resetDiscovery} style={{backgroundColor:C.accentDark,
          borderWidth:1,borderColor:C.accent,borderRadius:13,minHeight:46,
          alignItems:'center',justifyContent:'center',paddingHorizontal:18}}>
        <Text style={{color:C.accent,fontWeight:'800',fontSize:14}}>Clear filters</Text>
      </Pressable>:null}
      <Pressable accessibilityRole="button" accessibilityLabel="Explore clubs from Shop"
        onPress={onExploreClubs} style={{backgroundColor:C.accent,
          borderRadius:14,minHeight:49,alignItems:'center',justifyContent:'center',
          flexDirection:'row',gap:8,marginTop:4}}>
        <Text style={{fontSize:15,fontWeight:'800',color:'#0B1D1C'}}>Explore clubs</Text>
        <Ionicons name="arrow-forward" size={18} color="#0B1D1C"/>
      </Pressable>
      <Text style={{color:C.muted,fontSize:12,lineHeight:18,textAlign:'center'}}>
        No products, orders or payments are live.
      </Text>
    </View> : <>
      <View style={{paddingHorizontal:18,paddingTop:22,paddingBottom:13,
        flexDirection:'row',alignItems:'baseline',justifyContent:'space-between',gap:12}}>
        <Text style={{fontSize:21,color:C.ink,fontWeight:'800',
          letterSpacing:-0.35}}>{sectionTitle}</Text>
        {section!=='orders'?<Text style={{fontSize:13,color:C.muted}}>
          {filtered.length} {filtered.length===1?'item':'items'}
        </Text>:null}
      </View>
      {section!=='orders' && filtered.length>0 ?
        <View style={{flexDirection:'row',flexWrap:'wrap',gap:12,paddingHorizontal:16}}>
          {filtered.map(product=><View key={product.id} testID={'shop-card-'+product.id}
            style={{width:'48%',backgroundColor:C.panel,
              borderRadius:17,overflow:'hidden',borderWidth:1,borderColor:C.border}}>
            <Pressable accessibilityRole="button" accessibilityLabel={'View listing '+product.name}
              onPress={()=>openProduct(product)} style={{flex:1}}>
              <View style={{aspectRatio:0.98,backgroundColor:product.accent}}>
                <Image source={{uri:product.imageUrl}} accessibilityLabel={product.imageAlt}
                  style={{width:'100%',height:'100%'}} resizeMode="cover"/>
                <View style={{position:'absolute',top:10,left:10,
                  paddingVertical:5,paddingHorizontal:8,borderRadius:7,
                  backgroundColor:'rgba(3,8,12,0.82)'}}>
                  <Text style={{fontSize:10,fontWeight:'800',color:'#FFFFFF',
                    letterSpacing:0.45}}>SAMPLE</Text>
                </View>
              </View>
              <View style={{paddingHorizontal:12,paddingTop:12,paddingBottom:14,gap:6}}>
                <Text style={{fontSize:12,color:C.muted}} numberOfLines={1}>{product.merchant}</Text>
                <Text style={{fontSize:14,lineHeight:20,color:C.ink,fontWeight:'700',minHeight:40}}
                  numberOfLines={2}>{product.name}</Text>
                <Text style={{color:C.ink,fontSize:19,fontWeight:'900'}}>{product.price}</Text>
                <View style={{flexDirection:'row',alignItems:'center',gap:4,marginTop:3}}>
                  <Text style={{color:C.accent,fontSize:12,fontWeight:'700'}}>View details</Text>
                  <Ionicons name="arrow-forward" size={13} color={C.accent}/>
                </View>
              </View>
            </Pressable>
            <Pressable accessibilityRole="button"
              accessibilityLabel={(saved.has(product.id)?'Unsave ':'Save ')+product.name}
              onPress={()=>onToggleSaved(product.id)}
              style={{position:'absolute',right:9,top:9,backgroundColor:'rgba(3,8,12,0.84)',
                borderRadius:22,width:42,height:42,justifyContent:'center',alignItems:'center'}}>
              <Ionicons name={saved.has(product.id)?'heart':'heart-outline'}
                size={21} color={saved.has(product.id)?C.accent:'#FFFFFF'}/>
            </Pressable>
          </View>)}
        </View>
      : <View style={{marginHorizontal:18,backgroundColor:C.panel,
          borderRadius:20,borderWidth:1,borderColor:C.border,marginTop:4,
          paddingHorizontal:22,paddingVertical:30,alignItems:'center',gap:13}}>
          <View style={{width:56,height:56,borderRadius:19,backgroundColor:C.accentDark,
            alignItems:'center',justifyContent:'center'}}>
            <Ionicons name={emptyIcon} size={27} color={C.accent}/>
          </View>
          <Text style={{fontSize:19,fontWeight:'800',color:C.ink,textAlign:'center'}}>
            {emptyTitle}
          </Text>
          <Text style={{fontSize:14,lineHeight:21,color:C.muted,textAlign:'center'}}>
            {emptyDescription}
          </Text>
          {section==='discover' && hasDiscoveryFilters?
            <Pressable accessibilityRole="button" accessibilityLabel="Clear all Shop filters"
              onPress={resetDiscovery} style={{minHeight:46,paddingHorizontal:22,
                backgroundColor:C.accent,borderRadius:13,
                justifyContent:'center',alignItems:'center',marginTop:5}}>
              <Text style={{fontSize:14,fontWeight:'800',color:'#0B1D1C'}}>Clear filters</Text>
            </Pressable>
          :section==='saved'||section==='basket'?
            <Pressable accessibilityRole="button" accessibilityLabel="Browse Shop listings"
              onPress={browse} style={{minHeight:46,paddingHorizontal:22,
                backgroundColor:C.accentDark,borderRadius:13,
                justifyContent:'center',alignItems:'center',marginTop:5}}>
              <Text style={{fontSize:14,fontWeight:'800',color:C.accent}}>Browse Shop</Text>
            </Pressable>
          :null}
        </View>}
      {section==='basket'&&filtered.length>0?<Text style={{color:C.muted,
        paddingHorizontal:18,paddingTop:14,fontSize:13,lineHeight:19}}>
        Preview basket only. Checkout is unavailable until the marketplace is connected.
      </Text>:null}
    </>}
  </View>;
}
