import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C, s } from './styles';
import { demoListings } from './sampleData';

type Item = (typeof demoListings)[number];
type Page = 'discover' | 'saved' | 'basket' | 'orders';
const categories = ['All', 'Accessories', 'Vehicles', 'Rentals'] as const;
const interests = ['All', 'Cars', 'Motorcycles', 'Cycling'] as const;

export function ShopScreen({ items, collectionItems, search, onSearch, category, onCategory, onOpenProfile }: {
  items: readonly Item[];
  collectionItems: readonly Item[];
  search: string;
  onSearch: (value:string) => void;
  category: string;
  onCategory: (value:string) => void;
  onOpenProfile: () => void;
}) {
  const [section,setSection] = useState<Page>('discover');
  const [interest,setInterest] = useState<string>('All');
  const [selected,setSelected] = useState<string|null>(null);
  const [shop,setShop] = useState<string|null>(null);
  const [saved,setSaved] = useState<Set<string>>(() => new Set());
  const [basket,setBasket] = useState<Set<string>>(() => new Set());
  const [message,setMessage] = useState<string|null>(null);
  const item = selected ? collectionItems.find(x => x.id === selected) : null;
  const filtered = useMemo(() => (section === 'discover' ? items : collectionItems).filter(x =>
    (section !== 'discover' || interest === 'All' || x.topic === interest) &&
    (section !== 'saved' || saved.has(x.id)) &&
    (section !== 'basket' || basket.has(x.id)) &&
    (!shop || x.merchant === shop)
  ),[items,collectionItems,interest,section,saved,basket,shop]);

  function toggle(setter:React.Dispatch<React.SetStateAction<Set<string>>>,id:string) {
    setter(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function openProduct(product:Item) { setSelected(product.id);setMessage(null); }
  function addProduct(product:Item) {
    if (product.type !== 'Product') {
      setMessage('Enquiries and rental bookings require verified businesses. This is only a preview.');
      return;
    }
    setBasket(previous => new Set(previous).add(product.id));
    setMessage('Added to your preview basket. No payment or order was created.');
  }
  function browse() { setSelected(null);setShop(null);setSection('discover');setMessage(null); }
  const filterButton = (label:string,active:boolean,onPress:()=>void,prefix:string) =>
    <Pressable key={label} accessibilityRole="button" accessibilityLabel={prefix+label}
      accessibilityState={{selected:active}} onPress={onPress}
      style={{borderRadius:11,paddingVertical:9,paddingHorizontal:13,borderWidth:1,
        borderColor:active?C.accent:C.border,backgroundColor:active?C.accentDark:C.panel}}>
      <Text style={{color:active?C.accent:C.muted,fontSize:12,fontWeight:'800'}}>{label}</Text>
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
          onPress={()=>toggle(setSaved,item.id)} style={[s.ghost,{justifyContent:'center',minWidth:54}]}>
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

  return <View testID="shop-discovery" style={{gap:15,paddingBottom:26,width:'100%',maxWidth:850,alignSelf:'center'}}>
    <View style={{paddingHorizontal:16,paddingTop:7,gap:13}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}>
        <View style={{gap:2}}>
          <Text style={{color:C.ink,fontSize:27,fontWeight:'900'}}>Shop</Text>
          <Text style={{color:C.muted,fontSize:11}}>Marketplace · Example listings</Text>
        </View>
        <View style={{flexDirection:'row'}}>
          <Pressable accessibilityRole="button" accessibilityLabel="Open profile"
            onPress={onOpenProfile} style={{padding:9}}>
            <Ionicons name="person-circle-outline" color={C.ink} size={24}/>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Shop saved"
            onPress={()=>{setSection('saved');setShop(null);}} style={{padding:9}}>
            <Ionicons name="heart-outline" color={C.ink} size={24}/>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Shop basket"
            onPress={()=>{setSection('basket');setShop(null);}} style={{padding:9}}>
            <Ionicons name="bag-outline" color={C.ink} size={24}/>
            {basket.size>0?<Text style={{position:'absolute',right:0,top:0,color:C.accent,fontWeight:'900'}}>
              {basket.size}
            </Text>:null}
          </Pressable>
        </View>
      </View>
      <View style={{backgroundColor:'transparent',borderBottomWidth:1,borderBottomColor:'#3B4752',
        paddingHorizontal:0,minHeight:48,flexDirection:'row',alignItems:'center',gap:10}}>
        <Ionicons name="search" color={C.muted} size={20}/>
        <TextInput accessibilityLabel="Search marketplace" value={search} onChangeText={onSearch}
          placeholder="Search products and businesses…" placeholderTextColor={C.muted}
          style={{flex:1,color:C.ink,backgroundColor:'transparent',fontSize:16,minHeight:43}}/>
        {search.length>0?<Pressable accessibilityRole="button" accessibilityLabel="Clear Shop search" onPress={()=>onSearch('')}>
          <Ionicons name="close-circle" size={21} color={C.muted}/>
        </Pressable>:null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8}}>
        {categories.map(x=>filterButton(x,category===x,()=>{onCategory(x);setSection('discover');},'Shop category '))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:16}}>
        {interests.map(x=> <Pressable key={x} accessibilityRole="button" accessibilityLabel={'Shop interest '+x}
          onPress={()=>setInterest(x)} style={{paddingVertical:6,borderBottomWidth:2,
            borderBottomColor:interest===x?C.accent:'transparent'}}>
          <Text style={{color:interest===x?C.ink:C.muted,fontWeight:'800',fontSize:12}}>{x}</Text>
        </Pressable>)}
      </ScrollView>
      <View style={{flexDirection:'row',alignItems:'center',gap:6}}>
        <Ionicons name="shield-checkmark-outline" color={C.accent} size={15}/>
        <Text style={{fontSize:11,color:C.accent,fontWeight:'800'}}>Verified only</Text>
        <Text style={{fontSize:11,color:C.muted}}>at launch · Demo merchants shown</Text>
      </View>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
      contentContainerStyle={{paddingHorizontal:16,gap:8}}>
      {(['discover','saved','basket','orders'] as const).map(x=>filterButton(
        x==='discover'?'Discover':x==='saved'?'Saved':x==='basket'?'Basket':'Orders',
        section===x,()=>{setSection(x);setShop(null);},'Shop section '
      ))}
    </ScrollView>
    {shop?<View style={{paddingHorizontal:16,gap:8}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Shop" onPress={browse}
        style={{flexDirection:'row',gap:6,alignItems:'center'}}>
        <Ionicons name="arrow-back" size={18} color={C.accent}/>
        <Text style={{color:C.accent,fontWeight:'800'}}>All shops</Text>
      </Pressable>
      <Text style={{color:C.ink,fontWeight:'900',fontSize:19}}>{shop}</Text>
      <Text style={{color:C.muted,fontSize:12}}>Sample storefront · Approval not connected</Text>
    </View>:null}
    {section==='orders'?<View style={{alignItems:'center',paddingHorizontal:20,paddingVertical:55,gap:11}}>
      <Ionicons name="receipt-outline" color={C.accent} size={34}/>
      <Text style={{color:C.ink,fontSize:17,fontWeight:'800'}}>No orders yet</Text>
      <Text style={{color:C.muted,textAlign:'center',fontSize:13}}>
        Orders will be available after business verification, payment integration and consumer protections.
      </Text>
    </View>:<>
      <View style={{paddingHorizontal:16,flexDirection:'row',justifyContent:'space-between'}}>
        <Text style={{color:C.ink,fontSize:18,fontWeight:'900'}}>
          {section==='saved'?'Saved items':section==='basket'?'Preview basket':shop?'Store products':'Discover'}
        </Text>
        <Text style={{color:C.muted,fontSize:11}}>{filtered.length} items</Text>
      </View>
      {filtered.length?<View style={{flexDirection:'row',flexWrap:'wrap',gap:10,paddingHorizontal:11}}>
        {filtered.map(product=><View key={product.id} testID={'shop-card-'+product.id}
          style={{width:'48%',borderWidth:1,borderColor:C.border,backgroundColor:C.panel,
            borderRadius:13,overflow:'hidden'}}>
          <Pressable accessibilityRole="button" accessibilityLabel={'View listing '+product.name}
            onPress={()=>openProduct(product)}>
            <View style={{aspectRatio:1,backgroundColor:product.accent}}>
              <Image source={{uri:product.imageUrl}} accessibilityLabel={product.imageAlt}
                style={{width:'100%',height:'100%'}} resizeMode="cover"/>
              <View style={{position:'absolute',top:8,left:8,paddingHorizontal:7,
                paddingVertical:4,backgroundColor:'rgba(0,0,0,0.75)',borderRadius:6}}>
                <Text style={{color:'#FFFFFF',fontSize:10,fontWeight:'900'}}>DEMO</Text>
              </View>
            </View>
            <View style={{padding:10,gap:6}}>
              <Text style={{color:C.muted,fontSize:10}} numberOfLines={1}>{product.merchant}</Text>
              <Text style={{color:C.ink,fontSize:14,fontWeight:'800',minHeight:37}}
                numberOfLines={2}>{product.name}</Text>
              <Text style={{color:C.ink,fontSize:18,fontWeight:'900'}}>{product.price}</Text>
            </View>
          </Pressable>
          <Pressable accessibilityRole="button"
            accessibilityLabel={(saved.has(product.id)?'Unsave ':'Save ')+product.name}
            onPress={()=>toggle(setSaved,product.id)}
            style={{position:'absolute',right:7,top:7,backgroundColor:'rgba(0,0,0,0.77)',
              borderRadius:20,width:33,height:33,justifyContent:'center',alignItems:'center'}}>
            <Ionicons name={saved.has(product.id)?'heart':'heart-outline'}
              size={20} color={saved.has(product.id)?C.accent:'#FFFFFF'}/>
          </Pressable>
        </View>)}
      </View>:<View style={{paddingHorizontal:16,paddingVertical:48,alignItems:'center',gap:10}}>
        <Ionicons name="search-outline" size={32} color={C.accent}/>
        <Text style={{color:C.ink,fontWeight:'800'}}>Nothing to show</Text>
        <Text style={{color:C.muted,textAlign:'center',fontSize:12}}>
          {section==='saved'?'Save products to see them here':section==='basket'?
            'Add sample products to your basket':'Try another search or category'}
        </Text>
      </View>}
      {section==='basket'&&filtered.length>0?<Text style={{color:C.muted,paddingHorizontal:16,fontSize:12}}>
        Preview basket only. Checkout is unavailable until the marketplace is connected.
      </Text>:null}
    </>}
  </View>;
}
