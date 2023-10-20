import { useState, useEffect, useContext, useMemo } from "react";
import DisplayProduct from "./display-product";
import { Select, SelectItem } from "@nextui-org/react";
import { nip19 } from "nostr-tools";
import { DeleteListing, NostrEvent } from "../nostr-helpers";
import { ProductContext } from "../context";
import { ProfileAvatar } from "./avatar";
import { CATEGORIES } from "./STATIC-VARIABLES";
import LocationDropdown from "./location-dropdown";

const DisplayEvents = ({
  focusedPubkey,
  clickNPubkey,
}: {
  focusedPubkey?: string;
  clickNPubkey: (npubkey: string) => void;
}) => {
  const [productData, setProductData] = useState<NostrEvent[]>([]);
  const [filteredProductData, setFilteredProductData] = useState([]);
  const [deletedProducts, setDeletedProducts] = useState<string[]>([]); // list of product ids that have been deleted
  const [isLoading, setIsLoading] = useState(true);
  const imageUrlRegExp = /(https?:\/\/.*\.(?:png|jpg|jpeg|gif))/i;
  const productDataContext = useContext(ProductContext);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedLocation, setSelectedLocation] = useState("");

  useEffect(() => {
    if (!productDataContext) return;
    setIsLoading(productDataContext.isLoading);
    if (!productDataContext.isLoading && productDataContext.productData) {
      // is product sub reaches eose then we can sort the product data
      let sortedProductData = [
        ...productDataContext.productData.sort(
          (a, b) => b.created_at - a.created_at,
        ),
      ]; // sorts most recently created to least recently created
      setProductData(sortedProductData);
      return;
    }
    setProductData(productDataContext.productData);
  }, [productDataContext]);

  const displayDate = (timestamp: number): string => {
    const d = new Date(timestamp * 1000);
    const dateString = d.toLocaleString();
    return dateString;
  };

  /** FILTERS PRODUCT DATA ON CATEGORY, LOCATION, FOCUSED PUBKEY (SELLER) **/
  useEffect(() => {
    let filteredData = productData.filter((event) => {
      // gets rid of products that were deleted
      return !deletedProducts.includes(event.id);
    });
    if (productData && !isLoading) {
      if (focusedPubkey) {
        filteredData = filteredData.filter(
          (event) => event.pubkey === focusedPubkey,
        );
      }
      if (selectedCategory !== "" && typeof selectedCategory !== "undefined") {
        filteredData = filteredData.filter((event) => {
          // project the 'tags' 2D array to an array of categories
          const eventCategories = event.tags
            .filter((tagArray) => tagArray[0] === "t")
            .map((tagArray) => tagArray[1]);
          // check if the selected category is within event categories
          return eventCategories.includes(selectedCategory);
        });
      }
      if (selectedLocation !== "" && typeof selectedLocation !== "undefined") {
        filteredData = filteredData.filter((event) => {
          // project the 'tags' 2D array to an array of categories
          const eventLocation = event.tags
            .filter((tagArray) => tagArray[0] === "location")
            .map((tagArray) => tagArray[1]);
          // check if the selected category is within event categories
          return eventLocation.some((location) =>
            location.includes(selectedLocation),
          );
        });
      }
    }
    setFilteredProductData(filteredData);
  }, [
    productData,
    isLoading,
    focusedPubkey,
    selectedCategory,
    selectedLocation,
    deletedProducts,
  ]);

  const handleDelete = async (productId: string, passphrase: string) => {
    try {
      await DeleteListing([productId], passphrase);
      setDeletedProducts((deletedProducts) => [...deletedProducts, productId]);
    } catch (e) {
      console.log(e);
    }
  };

  return (
    <div>
      <div className="flex space-x-2">
        <Select
          autoFocus
          className="mt-2"
          placeholder="Select category"
          value={selectedCategory}
          onChange={(event) => {
            const index = event.target.value;
            const selectedVal = CATEGORIES[index];
            setSelectedCategory(selectedVal);
          }}
        >
          {CATEGORIES.map((category, index) => (
            <SelectItem value={category} key={index}>
              {category}
            </SelectItem>
          ))}
        </Select>
        <LocationDropdown
          className="mt-2"
          placeholder="Select location"
          value={selectedLocation}
          onChange={(event) => {
            setSelectedLocation(event.target.value);
          }}
        />
      </div>
      {/* DISPLAYS PRODUCT LISTINGS HERE */}
      {filteredProductData.length != 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 my-2 overflow-y-scroll overflow-x-hidden max-h-[70vh] max-w-full">
          {filteredProductData.map((event, index) => {
            let npub = nip19.npubEncode(event.pubkey);
            return (
              <div
                key={event.sig + "-" + index}
                className="p-4 mb-4 mx-2 bg-gray-100 rounded-md shadow-lg"
              >
                <div className="flex justify-between items-center text-gray-600 text-xs md:text-sm">
                  <ProfileAvatar
                    pubkey={event.pubkey}
                    npub={npub}
                    clickNPubkey={clickNPubkey}
                  />
                  <span className="text-gray-400 ml-2 text-xs md:text-sm">
                    {displayDate(event.created_at)}
                  </span>
                </div>
                <div className="mt-2 text-gray-800 text-sm md:text-base whitespace-pre-wrap break-words">
                  {event.kind == 30402 ? (
                    <DisplayProduct
                      tags={event.tags}
                      eventId={event.id}
                      pubkey={event.pubkey}
                      handleDelete={handleDelete}
                    />
                  ) : event.content.indexOf(imageUrlRegExp) ? (
                    <div>
                      <p>{event.content.replace(imageUrlRegExp, "")}</p>
                      <img src={event.content.match(imageUrlRegExp)?.[0]} />
                    </div>
                  ) : (
                    <div>
                      <p>{event.content}</p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-8 flex items-center justify-center">
          <p className="text-xl break-words text-center">
            No listings found . . .
          </p>
        </div>
      )}
    </div>
  );
};

export default DisplayEvents;
